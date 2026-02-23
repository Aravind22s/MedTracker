import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  LogOut, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  BarChart3, 
  Pill, 
  ChevronRight,
  Mic,
  Send,
  Trash2,
  X,
  Edit2,
  MessageSquare,
  User,
  Bot,
  Settings,
  Volume2,
  Upload,
  Bell
} from 'lucide-react';
import { useAuthStore } from './store/authStore';
import { parseMedicineInput, ParsedMedicine } from './services/geminiService';
import { getChatResponse, ChatMessage } from './services/chatService';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { format, addDays, isSameDay, parseISO } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Components ---

const Button = ({ className, variant = 'primary', ...props }: any) => {
  const variants = {
    primary: 'bg-emerald-600 text-white hover:bg-emerald-700',
    secondary: 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200',
    outline: 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100',
  };
  return (
    <button 
      className={cn(
        'px-4 py-2 rounded-xl font-medium transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2',
        variants[variant as keyof typeof variants],
        className
      )} 
      {...props} 
    />
  );
};

const Card = ({ children, className }: any) => (
  <div className={cn('bg-white rounded-2xl border border-zinc-100 shadow-sm p-4', className)}>
    {children}
  </div>
);

// --- Main App ---

export default function App() {
  const { user, token, setAuth, logout } = useAuthStore();
  const [view, setView] = useState<'dashboard' | 'analytics' | 'add' | 'chat' | 'settings'>('dashboard');
  const [medicines, setMedicines] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [isAiParsing, setIsAiParsing] = useState(false);
  const [editingMedicine, setEditingMedicine] = useState<any>(null);

  // Chat state
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Auth States
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [activeReminder, setActiveReminder] = useState<any>(null);
  const lastRemindedRef = useRef<{ [key: string]: string }>({});
  const medicinesRef = useRef<any[]>([]);
  const logsRef = useRef<any[]>([]);
  const userRef = useRef<any>(null);

  // Keep refs in sync with state
  useEffect(() => {
    medicinesRef.current = medicines;
  }, [medicines]);

  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    if (token) {
      fetchData();
      const interval = setInterval(checkReminders, 30000); // Check every 30s for better precision
      return () => clearInterval(interval);
    }
  }, [token]); // Removed medicines from dependencies to prevent infinite loop

  const playReminderSound = async (soundType: string = 'default', customDataOverride?: string | null) => {
    const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AudioContextClass) return;
    
    const audioCtx = new AudioContextClass();
    
    try {
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const soundData = customDataOverride !== undefined ? customDataOverride : userRef.current?.custom_sound_data;

      if (soundType === 'custom' && soundData) {
        const response = await fetch(soundData);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        source.start();
        
        // Close context after playback
        source.onended = () => audioCtx.close();
        return;
      }

      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      if (soundType === 'chime') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.5);
      } else if (soundType === 'pulse') {
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
        oscillator.frequency.setValueAtTime(660, audioCtx.currentTime + 0.1);
        oscillator.frequency.setValueAtTime(440, audioCtx.currentTime + 0.2);
      } else {
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
      }

      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.5);
      
      oscillator.onended = () => audioCtx.close();
    } catch (e) {
      console.error("Audio playback error", e);
      audioCtx.close();
    }
  };

  const checkReminders = () => {
    const now = new Date();
    const currentTimeStr = format(now, 'HH:mm');
    const todayStr = format(now, 'yyyy-MM-dd');

    medicinesRef.current.forEach(med => {
      const lastLog = logsRef.current.find(l => l.medicine_id === med.id);
      const isTakenToday = lastLog && isSameDay(parseISO(lastLog.taken_at), now);
      
      // Check if snoozed
      const isSnoozed = med.snoozed_until && parseISO(med.snoozed_until) > now;

      // Check if it's time for the reminder
      const isReminderTime = med.reminder_time === currentTimeStr;
      
      // Unique key for this specific reminder occurrence
      const reminderKey = `${med.id}-${todayStr}-${currentTimeStr}`;

      if (!isTakenToday && !isSnoozed && isReminderTime && !lastRemindedRef.current[reminderKey]) {
        lastRemindedRef.current[reminderKey] = 'triggered';
        console.log(`Reminder: Time to take ${med.name}`);
        playReminderSound(userRef.current?.reminder_sound);
        
        if (notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
          new Notification(`Time for your ${med.name}`, {
            body: `Dosage: ${med.dosage}. ${med.instructions || ''}`,
            icon: '/favicon.ico'
          });
        }
        
        setActiveReminder(med);
      }
    });
  };

  const requestNotifications = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationsEnabled(permission === 'granted');
    }
  };

  const fetchData = async () => {
    try {
      const [medsRes, logsRes, statsRes, userRes] = await Promise.all([
        fetch('/api/medicines', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/logs', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/analytics', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/user/me', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      
      if (medsRes.ok) setMedicines(await medsRes.json());
      if (logsRes.ok) setLogs(await logsRes.json());
      if (statsRes.ok) setAnalytics(await statsRes.json());
      if (userRes.ok) {
        const userData = await userRes.json();
        setAuth(userData, token!);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/signup';
    const body = isLogin ? { email, password } : { email, password, name };
    
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setAuth(data.user, data.token);
      } else {
        alert(data.error);
      }
    } catch (e) {
      alert('Auth failed');
    } finally {
      setLoading(false);
    }
  };

  const handleAddMedicine = async (parsed: any) => {
    setLoading(true);
    try {
      const method = editingMedicine ? 'PUT' : 'POST';
      const url = editingMedicine ? `/api/medicines/${editingMedicine.id}` : '/api/medicines';
      
      const res = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ...parsed,
          start_date: parsed.start_date || (editingMedicine ? editingMedicine.start_date : new Date().toISOString()),
          end_date: parsed.end_date || (parsed.duration_days ? addDays(new Date(), parsed.duration_days).toISOString() : (editingMedicine ? editingMedicine.end_date : null)),
        }),
      });
      if (res.ok) {
        setView('dashboard');
        setEditingMedicine(null);
        fetchData();
        setAiInput('');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = (med: any) => {
    setEditingMedicine(med);
    setView('add');
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    
    const userMessage: ChatMessage = { role: 'user', text: chatInput };
    setChatHistory(prev => [...prev, userMessage]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const responseText = await getChatResponse(chatHistory, chatInput);
      const modelMessage: ChatMessage = { role: 'model', text: responseText || "I'm sorry, I couldn't process that." };
      setChatHistory(prev => [...prev, modelMessage]);
    } catch (e) {
      console.error(e);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleTakeNow = async () => {
    if (!activeReminder) return;
    await handleLogDose(activeReminder.id);
    setActiveReminder(null);
  };
  const handleUpdateSound = async (sound: string, customData?: string) => {
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ 
          reminder_sound: sound,
          custom_sound_data: customData
        }),
      });
      if (res.ok) {
        setAuth({ 
          ...user, 
          reminder_sound: sound, 
          custom_sound_data: customData !== undefined ? customData : user?.custom_sound_data 
        }, token!);
        
        // Small delay to ensure state is updated if we need to play custom sound
        setTimeout(() => playReminderSound(sound), 100);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 500000) { // 500KB limit
      alert("File is too large. Please choose a file under 500KB.");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      handleUpdateSound('custom', base64String);
    };
    reader.readAsDataURL(file);
  };

  const handleLogDose = async (medicineId: number) => {
    try {
      const res = await fetch('/api/logs', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          medicine_id: medicineId,
          taken_at: new Date().toISOString(),
          status: 'taken',
        }),
      });
      if (res.ok) {
        fetchData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSnooze = async (medicineId: number, minutes: number = 15) => {
    try {
      const res = await fetch(`/api/medicines/${medicineId}/snooze`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ minutes }),
      });
      if (res.ok) {
        fetchData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAiParse = async () => {
    if (!aiInput.trim()) return;
    setIsAiParsing(true);
    try {
      const parsed = await parseMedicineInput(aiInput);
      await handleAddMedicine(parsed);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsAiParsing(false);
    }
  };

  const handleDeleteMedicine = async (id: number) => {
    if (!confirm('Are you sure?')) return;
    try {
      await fetch(`/api/medicines/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-zinc-100 p-8"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mb-4">
              <Pill className="w-8 h-8 text-emerald-600" />
            </div>
            <h1 className="text-2xl font-bold text-zinc-900">MedTrack AI</h1>
            <p className="text-zinc-500 text-center mt-2">
              Your intelligent companion for medicine adherence.
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Name</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                  placeholder="John Doe"
                  required
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Email</label>
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                placeholder="john@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Password</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                placeholder="••••••••"
                required
              />
            </div>
            <Button type="submit" className="w-full py-4 text-lg" disabled={loading}>
              {loading ? 'Processing...' : isLogin ? 'Sign In' : 'Create Account'}
            </Button>
          </form>

          <div className="mt-6 text-center space-y-4">
            <button 
              onClick={() => {
                setEmail('demo@example.com');
                setPassword('password123');
              }}
              className="text-sm text-zinc-400 hover:text-emerald-600 transition-colors"
            >
              Use Demo Credentials
            </button>
            <div>
              <button 
                onClick={() => setIsLogin(!isLogin)}
                className="text-emerald-600 font-medium hover:underline"
              >
                {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 pb-24 font-sans text-zinc-900">
      {/* Header */}
      <header className="bg-white border-bottom border-zinc-100 px-6 py-4 sticky top-0 z-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <Pill className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <h2 className="font-bold text-zinc-900">MedTrack AI</h2>
            <p className="text-xs text-zinc-500">Welcome back, {user?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!notificationsEnabled && (
            <button 
              onClick={requestNotifications}
              className="p-2 text-zinc-400 hover:text-emerald-500 transition-colors"
              title="Enable Notifications"
            >
              <AlertCircle className="w-5 h-5" />
            </button>
          )}
          <button onClick={logout} className="p-2 text-zinc-400 hover:text-red-500 transition-colors">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-6 space-y-6">
        <AnimatePresence mode="wait">
          {view === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold">Today's Schedule</h3>
                <span className="text-sm text-zinc-500">{format(new Date(), 'EEEE, MMM do')}</span>
              </div>

              {medicines.length === 0 ? (
                <Card className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mb-4">
                    <Calendar className="w-8 h-8 text-zinc-300" />
                  </div>
                  <p className="text-zinc-500">No medicines added yet.</p>
                  <Button variant="secondary" className="mt-4" onClick={() => setView('add')}>
                    Add your first medicine
                  </Button>
                </Card>
              ) : (
                <div className="space-y-4">
                  {medicines.map((med) => {
                    const lastLog = logs.find(l => l.medicine_id === med.id);
                    const isTakenToday = lastLog && isSameDay(parseISO(lastLog.taken_at), new Date());
                    
                    return (
                      <Card key={med.id} className="group relative overflow-hidden">
                        <div className="flex items-start justify-between">
                          <div className="flex gap-4">
                            <div className={cn(
                              "w-12 h-12 rounded-2xl flex items-center justify-center transition-colors",
                              isTakenToday ? "bg-emerald-50 text-emerald-600" : "bg-zinc-100 text-zinc-500"
                            )}>
                              {isTakenToday ? <CheckCircle2 className="w-6 h-6" /> : <Clock className="w-6 h-6" />}
                            </div>
                            <div>
                              <h4 className="font-bold text-lg">{med.name}</h4>
                              <p className="text-sm text-zinc-500">{med.dosage} • {med.frequency}</p>
                              {med.instructions && (
                                <p className="text-xs text-zinc-400 mt-1 italic">"{med.instructions}"</p>
                              )}
                              {med.snoozed_until && parseISO(med.snoozed_until) > new Date() && (
                                <p className="text-xs text-amber-600 mt-1 font-medium flex items-center gap-1">
                                  <Clock className="w-3 h-3" /> Snoozed until {format(parseISO(med.snoozed_until), 'h:mm a')}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <div className="flex gap-2">
                              {!isTakenToday && (
                                <Button 
                                  variant="outline"
                                  onClick={() => handleSnooze(med.id)}
                                  className="px-3 py-1.5 text-sm"
                                >
                                  Snooze
                                </Button>
                              )}
                              <Button 
                                variant={isTakenToday ? 'secondary' : 'primary'}
                                disabled={isTakenToday}
                                onClick={() => handleLogDose(med.id)}
                                className="px-3 py-1.5 text-sm"
                              >
                                {isTakenToday ? 'Taken' : 'Log Dose'}
                              </Button>
                            </div>
                            <div className="flex items-center gap-1">
                              <button 
                                onClick={() => handleEditClick(med)}
                                className="p-1 text-zinc-300 hover:text-emerald-500 opacity-0 group-hover:opacity-100 transition-all"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => handleDeleteMedicine(med.id)}
                                className="p-1 text-zinc-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}

              <div className="space-y-4">
                <h3 className="text-xl font-bold">Recent Activity</h3>
                <div className="space-y-2">
                  {logs.slice(0, 5).map((log) => (
                    <div key={log.id} className="flex items-center justify-between p-3 bg-white rounded-xl border border-zinc-100 text-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="font-medium">{log.medicine_name}</span>
                      </div>
                      <span className="text-zinc-500">{format(parseISO(log.taken_at), 'h:mm a')}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {view === 'analytics' && (
            <motion.div 
              key="analytics"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <h3 className="text-xl font-bold">Adherence Analytics</h3>
              
              <Card className="h-80 flex flex-col">
                <h4 className="text-sm font-medium text-zinc-500 mb-4">Daily Dose Completion</h4>
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                    <AreaChart data={analytics}>
                    <defs>
                      <linearGradient id="colorTaken" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fill: '#a1a1aa' }}
                      tickFormatter={(val) => format(parseISO(val), 'MMM d')}
                    />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#a1a1aa' }} />
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="taken" 
                      stroke="#10b981" 
                      fillOpacity={1} 
                      fill="url(#colorTaken)" 
                      strokeWidth={3}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

              <div className="grid grid-cols-2 gap-4">
                <Card className="flex flex-col items-center justify-center py-6">
                  <span className="text-3xl font-bold text-emerald-600">
                    {analytics.length > 0 ? Math.round((analytics.reduce((acc, curr) => acc + curr.taken, 0) / analytics.reduce((acc, curr) => acc + curr.total, 0)) * 100) : 0}%
                  </span>
                  <span className="text-xs text-zinc-500 mt-1 uppercase tracking-wider font-semibold">Avg Adherence</span>
                </Card>
                <Card className="flex flex-col items-center justify-center py-6">
                  <span className="text-3xl font-bold text-zinc-900">{medicines.length}</span>
                  <span className="text-xs text-zinc-500 mt-1 uppercase tracking-wider font-semibold">Active Meds</span>
                </Card>
              </div>
            </motion.div>
          )}

          {view === 'add' && (
            <motion.div 
              key="add"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-4">
                <button onClick={() => { setView('dashboard'); setEditingMedicine(null); }} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
                <h3 className="text-xl font-bold">{editingMedicine ? 'Edit Medicine' : 'Add Medicine'}</h3>
              </div>

              {!editingMedicine && (
                <Card className="bg-emerald-900 text-white border-none p-6 relative overflow-hidden">
                  <div className="relative z-10">
                    <h4 className="font-bold text-lg mb-2 flex items-center gap-2">
                      <Mic className="w-5 h-5" /> AI Assistant
                    </h4>
                    <p className="text-emerald-100 text-sm mb-4">
                      Describe your medicine schedule naturally. For example:
                      <br />
                      <span className="italic opacity-80">"Take 2 Advil every 6 hours for 3 days after meals"</span>
                    </p>
                    <div className="relative">
                      <textarea 
                        value={aiInput}
                        onChange={(e) => setAiInput(e.target.value)}
                        placeholder="Type instructions here..."
                        className="w-full bg-emerald-800/50 border border-emerald-700 rounded-xl px-4 py-3 text-white placeholder-emerald-400 outline-none focus:ring-2 focus:ring-emerald-400 min-h-[100px] resize-none"
                      />
                      <button 
                        onClick={handleAiParse}
                        disabled={isAiParsing || !aiInput.trim()}
                        className="absolute bottom-3 right-3 p-2 bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {isAiParsing ? (
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Send className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full -mr-16 -mt-16 blur-3xl" />
                  <div className="absolute bottom-0 left-0 w-24 h-24 bg-emerald-400/10 rounded-full -ml-12 -mb-12 blur-2xl" />
                </Card>
              )}

              <form className="space-y-4" onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const startDate = formData.get('start_date') as string;
                const endDate = formData.get('end_date') as string;
                
                handleAddMedicine({
                  name: formData.get('name') as string,
                  dosage: formData.get('dosage') as string,
                  frequency: formData.get('frequency') as string,
                  time_of_day: formData.get('time_of_day') as string,
                  instructions: formData.get('instructions') as string,
                  reminder_time: formData.get('reminder_time') as string,
                  start_date: startDate ? new Date(startDate).toISOString() : undefined,
                  end_date: endDate ? new Date(endDate).toISOString() : undefined,
                } as any);
              }}>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Medicine Name</label>
                    <input name="name" defaultValue={editingMedicine?.name} required className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500" placeholder="e.g. Lisinopril" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Dosage</label>
                    <input name="dosage" defaultValue={editingMedicine?.dosage} required className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500" placeholder="e.g. 10mg" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Frequency</label>
                    <input name="frequency" defaultValue={editingMedicine?.frequency} required className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500" placeholder="e.g. Daily" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Reminder Time</label>
                    <input type="time" name="reminder_time" defaultValue={editingMedicine?.reminder_time || '08:00'} required className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Special Instructions</label>
                    <input name="instructions" defaultValue={editingMedicine?.instructions} className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500" placeholder="e.g. With food" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Start Date</label>
                    <input type="date" name="start_date" defaultValue={editingMedicine?.start_date ? format(parseISO(editingMedicine.start_date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')} className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">End Date (Optional)</label>
                    <input type="date" name="end_date" defaultValue={editingMedicine?.end_date ? format(parseISO(editingMedicine.end_date), 'yyyy-MM-dd') : ''} className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                </div>
                <Button type="submit" className="w-full py-4" disabled={loading}>
                  {loading ? 'Saving...' : editingMedicine ? 'Update Medicine' : 'Save Medicine'}
                </Button>
              </form>
            </motion.div>
          )}

          {view === 'chat' && (
            <motion.div 
              key="chat"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col h-[calc(100vh-180px)]"
            >
              <h3 className="text-xl font-bold mb-4">AI Health Assistant</h3>
              
              <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
                {chatHistory.length === 0 && (
                  <div className="text-center py-8 text-zinc-400">
                    <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p className="mb-6">Ask me anything about your medications or health.</p>
                    
                    <div className="grid grid-cols-1 gap-2 max-w-xs mx-auto">
                      <p className="text-xs font-bold uppercase tracking-widest text-zinc-300 mb-2">Example Prompts</p>
                      {[
                        "What are the side effects of Lisinopril?",
                        "I missed my morning dose of Metformin, what should I do?",
                        "Can I take Advil with my current medications?",
                        "How do I improve my medicine adherence?"
                      ].map((prompt, i) => (
                        <button
                          key={i}
                          onClick={() => setChatInput(prompt)}
                          className="text-left p-3 rounded-xl bg-white border border-zinc-100 text-xs text-zinc-600 hover:border-emerald-200 hover:bg-emerald-50 transition-all"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {chatHistory.map((msg, i) => (
                  <div key={i} className={cn(
                    "flex gap-3 max-w-[85%]",
                    msg.role === 'user' ? "ml-auto flex-row-reverse" : ""
                  )}>
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                      msg.role === 'user' ? "bg-emerald-100 text-emerald-600" : "bg-zinc-100 text-zinc-600"
                    )}>
                      {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                    </div>
                    <div className={cn(
                      "p-3 rounded-2xl text-sm",
                      msg.role === 'user' ? "bg-emerald-600 text-white rounded-tr-none" : "bg-white border border-zinc-100 rounded-tl-none"
                    )}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {isChatLoading && (
                  <div className="flex gap-3 max-w-[85%]">
                    <div className="w-8 h-8 rounded-full bg-zinc-100 text-zinc-600 flex items-center justify-center">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="bg-white border border-zinc-100 p-3 rounded-2xl rounded-tl-none flex gap-1">
                      <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce" />
                      <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce [animation-delay:0.2s]" />
                      <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                )}
              </div>

              <div className="relative">
                <input 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Ask a question..."
                  className="w-full px-4 py-3 pr-12 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button 
                  onClick={handleSendMessage}
                  disabled={!chatInput.trim() || isChatLoading}
                  className="absolute right-2 top-1.5 p-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          )}

          {view === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-4">
                <button onClick={() => setView('dashboard')} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
                <h3 className="text-xl font-bold">Settings</h3>
              </div>

              <Card className="space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <Volume2 className="w-5 h-5 text-emerald-600" />
                  <h4 className="font-bold">Reminder Sound</h4>
                </div>
                <p className="text-sm text-zinc-500 mb-4">Choose the sound that plays for your medicine reminders.</p>
                
                <div className="space-y-2">
                  {['default', 'chime', 'pulse', 'custom'].map((sound) => (
                    <div key={sound} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleUpdateSound(sound)}
                          className={cn(
                            "flex-1 flex items-center justify-between p-4 rounded-xl border transition-all",
                            user?.reminder_sound === sound 
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700" 
                              : "border-zinc-100 hover:border-zinc-200"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <span className="capitalize font-medium">{sound}</span>
                            {sound === 'custom' && user?.custom_sound_data && (
                              <span className="text-[10px] bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full uppercase font-bold">Uploaded</span>
                            )}
                          </div>
                          {user?.reminder_sound === sound && <CheckCircle2 className="w-5 h-5" />}
                        </button>
                        <button 
                          onClick={() => playReminderSound(sound)}
                          className="p-4 rounded-xl border border-zinc-100 hover:bg-zinc-50 text-zinc-400 hover:text-emerald-600 transition-all"
                          title="Test Sound"
                        >
                          <Volume2 className="w-5 h-5" />
                        </button>
                      </div>
                      
                      {sound === 'custom' && (
                        <div className="px-2">
                          <label className="flex items-center gap-2 text-xs text-zinc-500 cursor-pointer hover:text-emerald-600 transition-colors">
                            <Upload className="w-3 h-3" />
                            <span>{user?.custom_sound_data ? 'Replace custom sound' : 'Upload custom sound (MP3/WAV)'}</span>
                            <input 
                              type="file" 
                              accept="audio/*" 
                              className="hidden" 
                              onChange={handleFileUpload}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Bell className="w-5 h-5 text-emerald-600" />
                    <h4 className="font-bold">Notifications</h4>
                  </div>
                  <button 
                    onClick={requestNotifications}
                    className={cn(
                      "px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                      notificationsEnabled ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                    )}
                  >
                    {notificationsEnabled ? "Enabled" : "Enable"}
                  </button>
                </div>
                <p className="text-sm text-zinc-500">Enable desktop notifications for your medicine reminders.</p>
              </Card>

              <Card className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <User className="w-5 h-5 text-emerald-600" />
                  <h4 className="font-bold">Account Info</h4>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-zinc-500">Name</p>
                  <p className="font-medium">{user?.name}</p>
                </div>
                <div className="space-y-1 mt-4">
                  <p className="text-sm text-zinc-500">Email</p>
                  <p className="font-medium">{user?.email}</p>
                </div>
              </Card>

              <Button variant="danger" className="w-full py-4" onClick={logout}>
                <LogOut className="w-5 h-5" /> Sign Out
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {activeReminder && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center"
              >
                <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Bell className="w-10 h-10 text-emerald-600 animate-bounce" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Time for {activeReminder.name}</h2>
                <p className="text-zinc-500 mb-8">
                  Dosage: <span className="font-bold text-zinc-900">{activeReminder.dosage}</span>
                  {activeReminder.instructions && <><br />{activeReminder.instructions}</>}
                </p>
                
                <div className="space-y-3">
                  <Button className="w-full py-4 text-lg" onClick={handleTakeNow}>
                    <CheckCircle2 className="w-6 h-6" /> I've Taken It
                  </Button>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => {
                        handleSnooze(activeReminder.id, 15);
                        setActiveReminder(null);
                      }}
                      className="py-3 rounded-xl border border-zinc-200 font-bold text-sm hover:bg-zinc-50 transition-colors"
                    >
                      Snooze 15m
                    </button>
                    <button 
                      onClick={() => {
                        handleSnooze(activeReminder.id, 60);
                        setActiveReminder(null);
                      }}
                      className="py-3 rounded-xl border border-zinc-200 font-bold text-sm hover:bg-zinc-50 transition-colors"
                    >
                      Snooze 1h
                    </button>
                  </div>
                  
                  <button 
                    onClick={() => setActiveReminder(null)}
                    className="w-full py-3 text-zinc-400 font-bold text-sm hover:text-zinc-600 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-zinc-100 px-6 py-3 flex items-center justify-around z-20">
        <button 
          onClick={() => setView('dashboard')}
          className={cn(
            "flex flex-col items-center gap-1 transition-colors",
            view === 'dashboard' ? "text-emerald-600" : "text-zinc-400"
          )}
        >
          <Calendar className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Schedule</span>
        </button>
        
        <button 
          onClick={() => setView('add')}
          className="w-14 h-14 bg-emerald-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-200 -mt-10 border-4 border-zinc-50 active:scale-90 transition-all"
        >
          <Plus className="w-8 h-8" />
        </button>

        <button 
          onClick={() => setView('analytics')}
          className={cn(
            "flex flex-col items-center gap-1 transition-colors",
            view === 'analytics' ? "text-emerald-600" : "text-zinc-400"
          )}
        >
          <BarChart3 className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Analytics</span>
        </button>

        <button 
          onClick={() => setView('chat')}
          className={cn(
            "flex flex-col items-center gap-1 transition-colors",
            view === 'chat' ? "text-emerald-600" : "text-zinc-400"
          )}
        >
          <MessageSquare className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Chat</span>
        </button>

        <button 
          onClick={() => setView('settings')}
          className={cn(
            "flex flex-col items-center gap-1 transition-colors",
            view === 'settings' ? "text-emerald-600" : "text-zinc-400"
          )}
        >
          <Settings className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Settings</span>
        </button>
      </nav>
    </div>
  );
}
