import { useState, useEffect, useRef, useMemo } from 'react';
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
  Bell,
  Languages,
  Sparkles,
  Zap,
  MicOff
} from 'lucide-react';
import { useAuthStore } from './store/authStore';
import { parseMedicineInput, ParsedMedicine } from './services/geminiService';
import { getChatResponse, ChatMessage, translateText, getMedicineInsights, getBehavioralAnalysisInsights } from './services/chatService';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar
} from 'recharts';
import { format, addDays, isSameDay, parseISO } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ta', name: 'Tamil' },
];

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
  const [dbError, setDbError] = useState<{ error: string, message: string } | null>(null);
  const [aiInput, setAiInput] = useState('');
  const [isAiParsing, setIsAiParsing] = useState(false);
  const [editingMedicine, setEditingMedicine] = useState<any>(null);

  // Chat state
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [selectedInsight, setSelectedInsight] = useState<{ name: string, content: string } | null>(null);
  const [isInsightLoading, setIsInsightLoading] = useState(false);
  const [behaviorAnalysis, setBehaviorAnalysis] = useState<any>(null);
  const [behavioralInsights, setBehavioralInsights] = useState<string>('');
  const [isBehaviorLoading, setIsBehaviorLoading] = useState(false);

  // Analytics Calculations
  const adherenceStats = useMemo(() => {
    if (analytics.length === 0) return { streak: 0, missedLast7: 0, bestDay: 'N/A' };
    
    // Streak
    let streak = 0;
    const sorted = [...analytics].sort((a, b) => b.date.localeCompare(a.date));
    for (const day of sorted) {
      if (day.taken === day.total && day.total > 0) streak++;
      else if (day.total > 0) break; // Only break if it was a day with scheduled meds
    }

    // Missed last 7 days
    const last7 = analytics.slice(-7);
    const missedLast7 = last7.reduce((acc, curr) => acc + (curr.total - curr.taken), 0);

    // Best Day of Week
    const dayMap: Record<string, { total: number, taken: number }> = {};
    analytics.forEach(day => {
      const d = format(parseISO(day.date), 'EEEE');
      if (!dayMap[d]) dayMap[d] = { total: 0, taken: 0 };
      dayMap[d].total += day.total;
      dayMap[d].taken += day.taken;
    });
    
    let bestDay = 'N/A';
    let maxRate = -1;
    Object.entries(dayMap).forEach(([day, stats]) => {
      const rate = stats.total > 0 ? stats.taken / stats.total : 0;
      if (rate > maxRate) {
        maxRate = rate;
        bestDay = day;
      }
    });

    return { streak, missedLast7, bestDay };
  }, [analytics]);

  const medicineAdherence = useMemo(() => {
    return medicines.map(med => {
      const medLogs = logs.filter(l => l.medicine_id === med.id);
      const taken = medLogs.filter(l => l.status === 'taken').length;
      return { name: med.name, taken };
    }).sort((a, b) => b.taken - a.taken);
  }, [medicines, logs]);

  const [isListening, setIsListening] = useState(false);

  const startListening = (target: 'ai' | 'chat') => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addToast("Speech recognition not supported in this browser", "error");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = user?.language === 'ta' ? 'ta-IN' : 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
      setIsListening(false);
      if (event.error === 'not-allowed') {
        addToast("Microphone access denied", "error");
      } else if (event.error === 'no-speech') {
        addToast("No speech detected. Please try again.", "info");
      } else if (event.error === 'network') {
        addToast("Network error during speech recognition", "error");
      }
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (target === 'ai') {
        setAiInput(prev => prev + (prev ? ' ' : '') + transcript);
      } else {
        setChatInput(prev => prev + (prev ? ' ' : '') + transcript);
      }
    };

    recognition.start();
  };

  // Auth States
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [activeReminder, setActiveReminder] = useState<any>(null);
  const [notificationHistory, setNotificationHistory] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [toasts, setToasts] = useState<any[]>([]);

  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  };

  const authenticatedFetch = async (url: string, options: any = {}, retries = 50): Promise<Response> => {
    try {
      const headers: any = { ...options.headers };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      
      const res = await fetch(url, {
        ...options,
        headers
      });

      const contentType = res.headers.get("content-type");
      const isJson = contentType && contentType.includes("application/json");
      
      // Check if we hit the platform warmup page or a non-JSON response when we expect one
      // (Most of our API calls expect JSON)
      const text = await res.clone().text();
      const isWarmup = text.includes("Please wait while your application starts") || 
                       text.includes("Starting Server...") ||
                       text.includes("warmup_start_time") ||
                       text.includes("AI Studio Logo") ||
                       text.includes("warmup") ||
                       (text.includes("<!doctype html>") && url.startsWith('/api/'));

      // Only retry on 503 if it's NOT JSON (likely platform issue, not our DB error)
      const shouldRetry = isWarmup || (res.status === 503 && !isJson) || (!isJson && res.status === 200 && url.startsWith('/api/'));

      if (shouldRetry) {
        if (retries > 0) {
          console.log(`[CLIENT] Hit warmup page or invalid response for ${url}, retrying in 4s... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, 4000));
          return authenticatedFetch(url, options, retries - 1);
        }
      }

      return res;
    } catch (e) {
      if (retries > 0) {
        console.log(`[CLIENT] Fetch error for ${url}, retrying in 4s... (${retries} retries left)`, e);
        await new Promise(resolve => setTimeout(resolve, 4000));
        return authenticatedFetch(url, options, retries - 1);
      }
      throw e;
    }
  };

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
    const checkHealth = async () => {
      try {
        // Use a simple fetch here as we don't need authentication for health check
        // but we still want to handle the warmup page
        const fetchHealth = async (retries = 30): Promise<Response> => {
          const res = await fetch('/api/health');
          const contentType = res.headers.get("content-type");
          const isJson = contentType && contentType.includes("application/json");
          const text = await res.clone().text();
          
          const isWarmup = text.includes("Please wait while your application starts") || 
                           text.includes("Starting Server...") || 
                           text.includes("<!doctype html>") || 
                           text.includes("warmup_start_time") ||
                           text.includes("warmup");
          
          if (isWarmup || (res.status === 503 && !isJson)) {
            if (retries > 0) {
              await new Promise(resolve => setTimeout(resolve, 4000));
              return fetchHealth(retries - 1);
            }
          }
          return res;
        };

        const res = await fetchHealth();
        if (res.ok) {
          const text = await res.text();
          if (!text) return;
          
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const data = JSON.parse(text);
            console.log('API Health Check:', data);
          }
        }
      } catch (e) {
        console.error('API Health Check failed:', e);
      }
    };
    checkHealth();
  }, []);

  useEffect(() => {
    if (token) {
      fetchData();
      const interval = setInterval(checkReminders, 10000); // Check every 10s for better precision
      return () => clearInterval(interval);
    }
  }, [token]);

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

    if (medicinesRef.current.length === 0) return;

    medicinesRef.current.forEach(med => {
      if (!med.reminder_time) return;

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
        console.log(`[Reminder] Triggering for ${med.name} at ${currentTimeStr}`);
        
        playReminderSound(userRef.current?.reminder_sound);
        addToast(`Time for your ${med.name} (${med.dosage})`, 'info');
        setNotificationHistory(prev => [{ 
          id: Date.now(), 
          medName: med.name, 
          dosage: med.dosage,
          time: currentTimeStr, 
          date: todayStr 
        }, ...prev].slice(0, 10));
        
        if (Notification.permission === 'granted') {
          try {
            new Notification(`Time for your ${med.name}`, {
              body: `Dosage: ${med.dosage}. ${med.instructions || ''}`,
              icon: '/favicon.ico',
              tag: reminderKey // Prevent duplicate notifications for same event
            });
          } catch (e) {
            console.error("Notification failed", e);
          }
        }
        
        setActiveReminder(med);
      }
    });
  };

  const fetchData = async () => {
    try {
      const [medsRes, logsRes, statsRes, userRes, behaviorRes] = await Promise.all([
        authenticatedFetch('/api/medicines'),
        authenticatedFetch('/api/logs'),
        authenticatedFetch('/api/analytics'),
        authenticatedFetch('/api/user/me'),
        authenticatedFetch('/api/behavior-analysis'),
      ]);
      
      // Check for DB connection error (503)
      const anyRes = [medsRes, logsRes, statsRes, userRes, behaviorRes].find(r => r.status === 503);
      if (anyRes) {
        const errorData = await anyRes.json();
        setDbError(errorData);
        return;
      } else {
        setDbError(null);
      }
      
      const safeJson = async (res: Response) => {
        try {
          const text = await res.text();
          if (!text) return null;
          
          const contentType = res.headers.get("content-type");
          if (res.ok && contentType && contentType.includes("application/json")) {
            return JSON.parse(text);
          }
        } catch (e) {
          console.error('Error parsing JSON:', e);
        }
        return null;
      };

      const meds = await safeJson(medsRes);
      if (meds) {
        console.log(`[CLIENT] fetchData: Received ${meds.length} medicines`);
        setMedicines(meds);
      }

      const logsData = await safeJson(logsRes);
      if (logsData) setLogs(logsData);

      const stats = await safeJson(statsRes);
      if (stats) setAnalytics(stats);

      const userData = await safeJson(userRes);
      if (userData) {
        setAuth(userData, token!);
      }

      const behaviorData = await safeJson(behaviorRes);
      if (behaviorData) {
        setBehaviorAnalysis(behaviorData);
        if (!behavioralInsights) {
          generateBehavioralInsights(behaviorData);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const generateBehavioralInsights = async (data: any) => {
    if (!data) return;
    setIsBehaviorLoading(true);
    try {
      const insights = await getBehavioralAnalysisInsights(data, user?.language || 'en');
      setBehavioralInsights(insights);
    } catch (e) {
      console.error("Failed to generate behavioral insights", e);
    } finally {
      setIsBehaviorLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/signup';
    const body = isLogin ? { email, password } : { email, password, name };
    
    try {
      const res = await authenticatedFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, 30); // Even more retries for auth
      
      const contentType = res.headers.get("content-type");
      const text = await res.text();
      
      if (contentType && contentType.includes("application/json") && text) {
        let data: any;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.error('Failed to parse auth JSON:', e);
          addToast("Server returned invalid data. Retrying...", "error");
          // If parsing fails, it might be a transient issue, but we already retried in authenticatedFetch
          return;
        }
        
        if (res.ok) {
          setAuth(data.user, data.token);
        } else {
          addToast(data.error || 'Auth failed', "error");
        }
      } else {
        console.error('Non-JSON or empty response:', text);
        addToast("Server is still warming up. Please wait a moment and try again.", "info");
      }
    } catch (e) {
      addToast("Connection failed. Please check your internet or try again later.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleAddMedicine = async (parsed: any) => {
    setLoading(true);
    try {
      const method = editingMedicine ? 'PUT' : 'POST';
      const url = editingMedicine ? `/api/medicines/${editingMedicine.id}` : '/api/medicines';
      
      const res = await authenticatedFetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json'
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
      } else {
        const contentType = res.headers.get("content-type");
        const text = await res.text();
        
        if (contentType && contentType.includes("application/json") && text) {
          let data: any;
          try {
            data = JSON.parse(text);
          } catch (e) {
            console.error('Failed to parse save error JSON:', e);
            alert(`Failed to save medicine: Server error (${res.status})`);
            return;
          }
          alert(`Failed to save medicine: ${data.error || res.statusText}`);
        } else {
          console.error('Non-JSON or empty error response:', text);
          alert(`Failed to save medicine: Server error (${res.status})`);
        }
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
      const responseText = await getChatResponse(chatHistory, chatInput, user?.language || 'en');
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

  const handleGetInsight = async (med: any) => {
    setIsInsightLoading(true);
    try {
      const content = await getMedicineInsights(
        med.name, 
        med.dosage, 
        med.frequency, 
        med.instructions,
        LANGUAGES.find(l => l.code === user?.language)?.name || 'English'
      );
      setSelectedInsight({ name: med.name, content: content || "No insights available." });
    } catch (e) {
      console.error(e);
      addToast("Failed to get AI insights", "error");
    } finally {
      setIsInsightLoading(false);
    }
  };

  const handleUpdateSound = async (sound: string, customData?: string) => {
    try {
      const res = await authenticatedFetch('/api/user/settings', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json'
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
        } as any, token!);
        addToast("Settings saved", "success");
        
        // Small delay to ensure state is updated if we need to play custom sound
        setTimeout(() => playReminderSound(sound), 100);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateLanguage = async (langCode: string) => {
    try {
      const res = await authenticatedFetch('/api/user/settings', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ language: langCode }),
      });
      if (res.ok) {
        setAuth({ ...user, language: langCode } as any, token!);
        addToast(`Language updated to ${LANGUAGES.find(l => l.code === langCode)?.name}`, "success");
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
      const res = await authenticatedFetch('/api/logs', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          medicine_id: medicineId,
          taken_at: new Date().toISOString(),
          status: 'taken',
        }),
      });
      if (res.ok) {
        fetchData();
        addToast("Dose logged successfully!", "success");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSnooze = async (medicineId: number, minutes: number = 15) => {
    try {
      const res = await authenticatedFetch(`/api/medicines/${medicineId}/snooze`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
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
      addToast(`Added ${parsed.name} successfully!`, 'success');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsAiParsing(false);
    }
  };

  const handleDeleteMedicine = async (id: number) => {
    console.log(`[CLIENT] handleDeleteMedicine starting for ID: ${id}`);
    
    try {
      addToast("Deleting medicine...", "info");
      
      const res = await authenticatedFetch(`/api/medicines/${id}`, {
        method: 'DELETE'
      });
      
      console.log(`[CLIENT] Delete response status: ${res.status}`);
      
      let data: any = {};
      const contentType = res.headers.get("content-type");
      const text = await res.text();
      
      if (contentType && contentType.includes("application/json") && text) {
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.error('[CLIENT] JSON parse error:', e);
        }
      }

      if (res.ok) {
        console.log('[CLIENT] Delete success, refreshing...');
        addToast("Medicine removed", "success");
        await fetchData();
      } else {
        console.error('[CLIENT] Delete failed:', data);
        addToast(data.error || "Delete failed", "error");
      }
    } catch (e) {
      console.error('[CLIENT] Network error:', e);
      addToast("Connection error", "error");
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
          <button 
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-2 text-zinc-400 hover:text-emerald-600 transition-colors relative"
          >
            <Bell className="w-5 h-5" />
            {notificationHistory.length > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />
            )}
          </button>
          <button onClick={logout} className="p-2 text-zinc-400 hover:text-red-500 transition-colors">
            <LogOut className="w-5 h-5" />
          </button>
        </div>

        {/* Notification Dropdown */}
        <AnimatePresence>
          {showNotifications && (
            <>
              <div className="fixed inset-0 z-[15]" onClick={() => setShowNotifications(false)} />
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute top-16 right-6 w-72 bg-white rounded-2xl shadow-2xl border border-zinc-100 z-[20] overflow-hidden"
              >
                <div className="p-4 border-b border-zinc-50 flex items-center justify-between bg-zinc-50/50">
                  <h3 className="font-bold text-sm">Recent Alerts</h3>
                  <button 
                    onClick={() => setNotificationHistory([])}
                    className="text-[10px] uppercase font-bold text-zinc-400 hover:text-red-500 transition-colors"
                  >
                    Clear All
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notificationHistory.length === 0 ? (
                    <div className="p-8 text-center">
                      <Bell className="w-8 h-8 text-zinc-100 mx-auto mb-2" />
                      <p className="text-xs text-zinc-400 mb-4">No recent alerts</p>
                      <button 
                        onClick={() => {
                          addToast("Test Alert Triggered!", "info");
                          playReminderSound(user?.reminder_sound);
                          setNotificationHistory([{
                            id: Date.now(),
                            medName: "Test Medicine",
                            dosage: "10mg",
                            time: format(new Date(), 'HH:mm'),
                            date: format(new Date(), 'yyyy-MM-dd')
                          }]);
                        }}
                        className="text-[10px] uppercase font-bold text-emerald-600 hover:text-emerald-700"
                      >
                        Send Test Alert
                      </button>
                    </div>
                  ) : (
                    notificationHistory.map(item => (
                      <div key={item.id} className="p-4 border-b border-zinc-50 last:border-0 hover:bg-zinc-50 transition-colors">
                        <div className="flex justify-between items-start mb-1">
                          <h4 className="font-bold text-sm text-zinc-900">{item.medName}</h4>
                          <span className="text-[10px] text-zinc-400 font-medium">{item.time}</span>
                        </div>
                        <p className="text-xs text-zinc-500">Time for your {item.dosage} dose.</p>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
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
                  <Button variant="secondary" className="mt-4" onClick={() => { setView('add'); setEditingMedicine(null); }}>
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
                              <div className="flex items-center gap-2">
                                <h4 className="font-bold text-lg">{med.name}</h4>
                                <button 
                                  onClick={() => handleGetInsight(med)}
                                  className="p-1 text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors"
                                  title="AI Insight"
                                >
                                  <Sparkles className="w-4 h-4" />
                                </button>
                              </div>
                              <p className="text-sm text-zinc-500">{med.dosage} • {med.frequency}</p>
                              {med.instructions && (
                                <div className="mt-1 flex items-start gap-2">
                                  <p className="text-xs text-zinc-400 italic flex-1">"{med.instructions}"</p>
                                  {user?.language && user.language !== 'en' && (
                                    <button 
                                      onClick={async () => {
                                        const translated = await translateText(med.instructions, LANGUAGES.find(l => l.code === user.language)?.name || 'English');
                                        addToast(`Translated: ${translated}`, "info");
                                      }}
                                      className="p-1 text-zinc-300 hover:text-emerald-500 transition-colors"
                                      title="Translate Instructions"
                                    >
                                      <Languages className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
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
                                className="p-2 text-zinc-400 hover:text-emerald-600 transition-all"
                                title="Edit"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => handleDeleteMedicine(med.id)}
                                className="p-2 text-zinc-400 hover:text-red-500 transition-all"
                                title="Delete"
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

              <div className="grid grid-cols-3 gap-4">
                <Card className="flex flex-col items-center justify-center py-4">
                  <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center mb-2">
                    <Zap className="w-5 h-5 text-orange-600" />
                  </div>
                  <span className="text-xl font-bold text-zinc-900">{adherenceStats.streak}</span>
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Day Streak</span>
                </Card>
                <Card className="flex flex-col items-center justify-center py-4">
                  <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mb-2">
                    <AlertCircle className="w-5 h-5 text-red-600" />
                  </div>
                  <span className="text-xl font-bold text-zinc-900">{adherenceStats.missedLast7}</span>
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Missed (7d)</span>
                </Card>
                <Card className="flex flex-col items-center justify-center py-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mb-2">
                    <Calendar className="w-5 h-5 text-blue-600" />
                  </div>
                  <span className="text-sm font-bold text-zinc-900 truncate w-full text-center px-1">{adherenceStats.bestDay}</span>
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Best Day</span>
                </Card>
              </div>

              <Card className="p-6">
                <h4 className="text-sm font-bold text-zinc-900 mb-6 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-emerald-600" />
                  Medicine Adherence Trends
                </h4>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={medicineAdherence} layout="vertical" margin={{ left: 20 }}>
                      <XAxis type="number" hide />
                      <YAxis 
                        dataKey="name" 
                        type="category" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 12, fill: '#4b5563', fontWeight: 500 }}
                        width={80}
                      />
                      <Tooltip 
                        cursor={{ fill: 'transparent' }}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      />
                      <Bar 
                        dataKey="taken" 
                        fill="#10b981" 
                        radius={[0, 4, 4, 0]} 
                        barSize={20}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-6 bg-emerald-50 border-emerald-100">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-bold text-emerald-900 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-600" />
                    AI Behavioral Insights
                  </h4>
                  <button 
                    onClick={() => generateBehavioralInsights(behaviorAnalysis)}
                    disabled={isBehaviorLoading}
                    className="text-xs text-emerald-600 font-bold hover:underline disabled:opacity-50"
                  >
                    {isBehaviorLoading ? 'Analyzing...' : 'Refresh'}
                  </button>
                </div>
                
                {isBehaviorLoading ? (
                  <div className="space-y-3">
                    <div className="h-4 bg-emerald-200/50 rounded animate-pulse w-3/4" />
                    <div className="h-4 bg-emerald-200/50 rounded animate-pulse w-full" />
                    <div className="h-4 bg-emerald-200/50 rounded animate-pulse w-5/6" />
                  </div>
                ) : behavioralInsights ? (
                  <div className="markdown-body text-sm text-emerald-800 leading-relaxed">
                    <Markdown>{behavioralInsights}</Markdown>
                  </div>
                ) : (
                  <p className="text-sm text-emerald-600 italic">No behavioral data available yet. Keep logging your doses to see patterns.</p>
                )}
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
              key={editingMedicine ? `edit-${editingMedicine.id}` : 'add'}
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
                      <div className="absolute bottom-3 right-3 flex gap-2">
                        <button 
                          onClick={() => startListening('ai')}
                          disabled={isListening}
                          className={cn(
                            "p-2 rounded-lg transition-all",
                            isListening ? "bg-red-500 animate-pulse" : "bg-emerald-700 hover:bg-emerald-600"
                          )}
                          title="Voice to Text"
                        >
                          {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                        </button>
                        <button 
                          onClick={handleAiParse}
                          disabled={isAiParsing || !aiInput.trim()}
                          className="p-2 bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {isAiParsing ? (
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Send className="w-5 h-5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full -mr-16 -mt-16 blur-3xl" />
                  <div className="absolute bottom-0 left-0 w-24 h-24 bg-emerald-400/10 rounded-full -ml-12 -mb-12 blur-2xl" />
                </Card>
              )}

              <form className="space-y-4" onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const startDateVal = formData.get('start_date') as string;
                const endDateVal = formData.get('end_date') as string;
                
                const parsedStartDate = startDateVal ? new Date(startDateVal) : null;
                const parsedEndDate = endDateVal ? new Date(endDateVal) : null;

                handleAddMedicine({
                  name: formData.get('name') as string,
                  dosage: formData.get('dosage') as string,
                  frequency: formData.get('frequency') as string,
                  time_of_day: formData.get('time_of_day') as string,
                  instructions: formData.get('instructions') as string,
                  reminder_time: formData.get('reminder_time') as string,
                  start_date: parsedStartDate && !isNaN(parsedStartDate.getTime()) ? parsedStartDate.toISOString() : undefined,
                  end_date: parsedEndDate && !isNaN(parsedEndDate.getTime()) ? parsedEndDate.toISOString() : undefined,
                } as any);
              }}>
                <input type="hidden" name="time_of_day" defaultValue={editingMedicine?.time_of_day} />
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
                      {msg.role === 'user' ? (
                        msg.text
                      ) : (
                        <div className="markdown-body">
                          <Markdown>{msg.text}</Markdown>
                        </div>
                      )}
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
                  className="w-full px-4 py-3 pr-24 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <div className="absolute right-2 top-1.5 flex gap-1">
                  <button 
                    onClick={() => startListening('chat')}
                    disabled={isListening}
                    className={cn(
                      "p-1.5 rounded-lg transition-all",
                      isListening ? "bg-red-500 text-white animate-pulse" : "text-zinc-400 hover:text-emerald-600 hover:bg-zinc-50"
                    )}
                    title="Voice to Text"
                  >
                    {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>
                  <button 
                    onClick={handleSendMessage}
                    disabled={!chatInput.trim() || isChatLoading}
                    className="p-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
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
                <div className="flex items-center gap-3 mb-2">
                  <Languages className="w-5 h-5 text-emerald-600" />
                  <h4 className="font-bold">App Language</h4>
                </div>
                <p className="text-sm text-zinc-500 mb-4">Select your preferred language for AI chat and translations.</p>
                
                <div className="grid grid-cols-2 gap-2">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => handleUpdateLanguage(lang.code)}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-xl border transition-all text-sm",
                        user?.language === lang.code 
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-bold" 
                          : "border-zinc-100 hover:border-zinc-200"
                      )}
                    >
                      <span>{lang.name}</span>
                      {user?.language === lang.code && <CheckCircle2 className="w-4 h-4" />}
                    </button>
                  ))}
                </div>
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
          onClick={() => { setView('add'); setEditingMedicine(null); }}
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

      {/* Toasts */}
      <div className="fixed top-20 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {dbError && (
            <motion.div
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-red-600 text-white p-4 rounded-xl shadow-xl border border-red-500 pointer-events-auto flex items-start gap-3 max-w-sm"
            >
              <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold">{dbError.error}</h3>
                <p className="text-xs opacity-90">{dbError.message}</p>
              </div>
            </motion.div>
          )}
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={cn(
                "px-4 py-3 rounded-xl shadow-lg text-sm font-medium pointer-events-auto min-w-[200px] flex items-center gap-3",
                toast.type === 'success' ? "bg-emerald-600 text-white" : 
                toast.type === 'error' ? "bg-red-600 text-white" : 
                "bg-zinc-900 text-white"
              )}
            >
              {toast.type === 'success' && <CheckCircle2 className="w-4 h-4" />}
              {toast.type === 'error' && <AlertCircle className="w-4 h-4" />}
              {toast.type === 'info' && <Bell className="w-4 h-4" />}
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* AI Insight Modal */}
      <AnimatePresence>
        {selectedInsight && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-emerald-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{selectedInsight.name}</h3>
                    <p className="text-xs text-emerald-600 font-bold uppercase tracking-wider">AI Insight</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedInsight(null)}
                  className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
                >
                  <X className="w-6 h-6 text-zinc-400" />
                </button>
              </div>
              <div className="p-6 max-h-[60vh] overflow-y-auto">
                <div className="markdown-body text-zinc-600 leading-relaxed">
                  <Markdown>{selectedInsight.content}</Markdown>
                </div>
              </div>
              <div className="p-6 border-t border-zinc-100 bg-zinc-50 flex justify-end">
                <Button onClick={() => setSelectedInsight(null)}>Got it</Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Global AI Loading Overlay */}
      <AnimatePresence>
        {isInsightLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] bg-white/80 backdrop-blur-md flex flex-col items-center justify-center"
          >
            <div className="relative">
              <div className="w-20 h-20 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-emerald-600 animate-pulse" />
              </div>
            </div>
            <p className="mt-6 text-emerald-900 font-bold text-lg animate-pulse">Generating AI Insights...</p>
            <p className="text-zinc-500 text-sm mt-2">Analyzing medication data & safety info</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
