import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  ShieldCheck,
  Mail,
  Lock,
  LogIn,
  Sun,
  Moon,
  ArrowRight,
  UserRound,
  GraduationCap,
  UsersRound,
  CheckCircle2,
  ScanFace,
  QrCode,
} from 'lucide-react';
import { motion } from 'motion/react';

const Login: React.FC = () => {
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { success, error } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    // Auto populate email if passed via state or URL
    const stateEmail = (location.state as any)?.email;
    const searchParams = new URLSearchParams(location.search);
    const queryEmail = searchParams.get('email');
    if (stateEmail) {
      setEmail(stateEmail);
    } else if (queryEmail) {
      setEmail(queryEmail);
    }
  }, [location]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      error('Please fill in all fields.');
      return;
    }

    setIsSubmitting(true);

    try {
      const userProfile = await login(email, password);

      success(`Welcome back, ${userProfile.name}!`);

      if (userProfile.role === 'student') {
        navigate('/student/dashboard');
      } else if (userProfile.role === 'staff') {
        navigate('/staff/dashboard');
      } else if (userProfile.role === 'admin') {
        navigate('/admin/dashboard');
      }
    } catch (err: any) {
      console.error(err);
      error(err.message || 'Invalid credentials. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#050816] text-slate-900 dark:text-white transition-colors duration-300">

      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-violet-500/10 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full bg-blue-500/10 blur-[120px]" />
      </div>

      {/* Header */}
      <header className="relative z-20 flex items-center justify-between px-6 py-5 lg:px-10">

        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-600/25">
            <ShieldCheck className="w-5 h-5" />
          </div>

          <div>
            <p className="text-sm font-bold tracking-tight">
              Smart Face Attendance
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Secure Attendance Management
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className="flex items-center justify-center w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-violet-400 dark:hover:border-violet-500 transition-all shadow-sm"
        >
          {theme === 'dark' ? (
            <Sun className="w-5 h-5 text-amber-400" />
          ) : (
            <Moon className="w-5 h-5 text-slate-600" />
          )}
        </button>
      </header>

      {/* Main */}
      <main className="relative z-10 min-h-[calc(100vh-80px)] flex items-center justify-center px-5 py-10 lg:px-10">

        <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-10 lg:gap-20 items-center">

          {/* LEFT SIDE */}
          <motion.section
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="hidden lg:block"
          >

            <div className="max-w-xl">

              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-violet-200 dark:border-violet-900/60 bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 text-xs font-semibold mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                Secure Attendance Platform
              </div>

              <h1 className="text-5xl xl:text-6xl font-extrabold tracking-tight leading-[1.08]">
                Smarter way to
                <span className="block text-violet-600 dark:text-violet-400">
                  manage attendance.
                </span>
              </h1>

              <p className="mt-6 text-base leading-7 text-slate-600 dark:text-slate-400 max-w-lg">
                A simple web-based attendance system that helps students
                and staff manage attendance using secure identity
                verification and digital records.
              </p>

              {/* Features */}
              <div className="mt-8 space-y-4">

                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-500/10 flex items-center justify-center">
                    <ScanFace className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                  </div>

                  <div>
                    <p className="text-sm font-semibold">
                      Face Verification
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Verify student identity before attendance.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-500/10 flex items-center justify-center">
                    <QrCode className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>

                  <div>
                    <p className="text-sm font-semibold">
                      QR Code Attendance
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Quick attendance using QR verification.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>

                  <div>
                    <p className="text-sm font-semibold">
                      Digital Attendance Records
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Easily manage attendance and entry records.
                    </p>
                  </div>
                </div>

              </div>

              <div className="mt-10 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-500">
                <ShieldCheck className="w-4 h-4" />
                Secure role-based access for students and staff
              </div>

            </div>
          </motion.section>

          {/* RIGHT SIDE LOGIN */}
          <motion.section
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="w-full max-w-md mx-auto"
          >

            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl shadow-slate-300/30 dark:shadow-black/30 p-7 sm:p-9">

              {/* Mobile branding */}
              <div className="lg:hidden flex justify-center mb-5">
                <div className="w-14 h-14 rounded-2xl bg-violet-600 flex items-center justify-center text-white shadow-lg shadow-violet-600/25">
                  <ShieldCheck className="w-7 h-7" />
                </div>
              </div>

              <div className="text-center lg:text-left">
                <h2 className="text-2xl font-bold tracking-tight">
                  Welcome back
                </h2>

                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Sign in to continue to your account
                </p>
              </div>

              {/* Login Form */}
              <form
                onSubmit={handleSubmit}
                className="mt-8 space-y-5"
              >

                {/* Email */}
                <div>
                  <label className="block text-sm font-semibold mb-2">
                    Email Address
                  </label>

                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />

                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email"
                      className="w-full h-12 pl-12 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm outline-none transition-all placeholder:text-slate-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold">
                      Password
                    </label>
                  </div>

                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />

                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full h-12 pl-12 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm outline-none transition-all placeholder:text-slate-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10"
                    />
                  </div>
                </div>

                {/* Sign In */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="group w-full h-12 flex items-center justify-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold shadow-lg shadow-violet-600/25 hover:shadow-violet-600/35 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <LogIn className="w-5 h-5" />
                      Sign In
                      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                    </>
                  )}
                </button>

              </form>

              {/* Registration */}
              <div className="mt-7">

                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                  <span className="text-xs text-slate-400">
                    New member?
                  </span>
                  <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                </div>

                <div className="grid grid-cols-2 gap-3 mt-5">

                  <Link
                    to="/signup"
                    className="group flex items-center justify-center gap-2 h-11 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-violet-400 dark:hover:border-violet-500 bg-white dark:bg-slate-900 hover:bg-violet-50 dark:hover:bg-violet-500/10 text-sm font-semibold transition-all"
                  >
                    <GraduationCap className="w-4 h-4 text-violet-500" />
                    Student
                  </Link>

                  <Link
                    to="/staff/register"
                    className="group flex items-center justify-center gap-2 h-11 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-violet-400 dark:hover:border-violet-500 bg-white dark:bg-slate-900 hover:bg-violet-50 dark:hover:bg-violet-500/10 text-sm font-semibold transition-all"
                  >
                    <UsersRound className="w-4 h-4 text-violet-500" />
                    Staff
                  </Link>

                </div>
              </div>

              {/* Admin */}
              <div className="mt-7 pt-6 border-t border-slate-200 dark:border-slate-800">

                <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">

                  <div className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-500/10 flex items-center justify-center">
                    <ShieldCheck className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                  </div>

                  <div className="flex-1">
                    <p className="text-xs font-semibold">
                      Administrator Access
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-500">
                      Development environment
                    </p>
                  </div>

                  <UserRound className="w-4 h-4 text-slate-400" />

                </div>

              </div>

            </div>

            <p className="text-center text-[11px] text-slate-400 dark:text-slate-600 mt-5">
              Smart Face Attendance System • Secure Access
            </p>

          </motion.section>

        </div>
      </main>
    </div>
  );
};

export default Login;