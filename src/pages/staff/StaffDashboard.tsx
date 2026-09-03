import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import Header from '../../components/Header';
import { formatTime12hr, getLocalDateString } from '../../utils/faceUtils';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { StudentProfile, AttendanceRecord, StaffProfile } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, GraduationCap, Calendar, Download, FileSpreadsheet, 
  FileText, Users, CheckCircle, XCircle, AlertCircle, RefreshCw, BarChart2, CheckSquare, Eye,
  Lock, User, Mail, LogOut, CheckSquare as CheckIcon, ClipboardList, QrCode, ShieldCheck, Layers
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { updatePassword, updateProfile as authUpdateProfile } from 'firebase/auth';
import { auth } from '../../firebase/firebase';
import { getStudentAssignedClass, getDeptName, ACADEMIC_DEPARTMENTS } from '../../utils/academicData';

const StaffDashboard: React.FC = () => {
  const { staffProfile, userProfile, refreshProfile, logout } = useAuth();
  const { success, error, info } = useToast();

  const [activeTab, setActiveTab] = useState<'students' | 'daily' | 'monthly' | 'profile'>('students');
  const [loading, setLoading] = useState(true);

  // Loaded database lists
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);

  // Automatic assigned class lock
  const assignedClass = staffProfile?.assignedClass || 'CSDS - II';
  const staffDepartment = staffProfile?.department || 'CSDS';

  // Selection Inputs (Date remains configurable)
  const [targetDate, setTargetDate] = useState(getLocalDateString());

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // QR Code Modal State
  const [showQRModal, setShowQRModal] = useState(false);

  // Report Type (Daily, Weekly, Monthly)
  const [reportType, setReportType] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  // Edit Profile States
  const [editName, setEditName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Students
      const studentsSnap = await getDocs(collection(db, 'students'));
      const studentList: StudentProfile[] = [];
      studentsSnap.forEach((docSnap) => {
        studentList.push(docSnap.data() as StudentProfile);
      });
      setStudents(studentList);

      // 2. Fetch Attendance
      const attendanceSnap = await getDocs(collection(db, 'attendance'));
      const attendanceList: AttendanceRecord[] = [];
      attendanceSnap.forEach((docSnap) => {
        attendanceList.push(docSnap.data() as AttendanceRecord);
      });
      setAttendance(attendanceList);
    } catch (err: any) {
      console.error(err);
      error("Failed to sync records from databases.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Sync profile fields when staffProfile loads
  useEffect(() => {
    if (staffProfile) {
      setEditName(staffProfile.fullName || staffProfile.staffName || userProfile?.name || '');
    } else if (userProfile) {
      setEditName(userProfile.name || '');
    }
  }, [staffProfile, userProfile]);

  // Filter students AUTOMATICALLY based on assignedClass
  const getFilteredStudentsList = () => {
    return students.filter((s) => {
      const matchesSearch = s.studentName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            s.rollNumber.toLowerCase().includes(searchQuery.toLowerCase());
      const sClass = getStudentAssignedClass(s);
      return matchesSearch && sClass === assignedClass;
    });
  };

  const filteredStudents = getFilteredStudentsList();

  // Daily attendance report automatically filtered by assignedClass
  const getDailyAttendanceReport = () => {
    return students
      .filter((s) => getStudentAssignedClass(s) === assignedClass)
      .map((student) => {
        const log = attendance.find((a) => a.studentId === student.uid && a.date === targetDate);
        return {
          student,
          log: log || null
        };
      })
      .filter((entry) => {
        if (!searchQuery) return true;
        return entry.student.studentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
               entry.student.rollNumber.toLowerCase().includes(searchQuery.toLowerCase());
      });
  };

  const dailyAttendanceReport = getDailyAttendanceReport();

  // Calculate stats based on assigned class
  const totalInScope = dailyAttendanceReport.length;
  const presentToday = dailyAttendanceReport.filter(r => r.log?.overallStatus === 'Present').length;
  const halfDayToday = dailyAttendanceReport.filter(r => r.log?.overallStatus === 'Half Day').length;
  const needsReviewToday = dailyAttendanceReport.filter(r => r.log?.overallStatus === 'Needs Staff Review').length;
  const absentToday = totalInScope - (presentToday + halfDayToday + needsReviewToday);

  // EXPORT TO EXCEL
  const handleExportExcel = () => {
    try {
      const targetStudents = students.filter((s) => getStudentAssignedClass(s) === assignedClass);

      let exportData = [];

      if (reportType === 'daily') {
        exportData = targetStudents.map((student) => {
          const log = attendance.find((a) => a.studentId === student.uid && a.date === targetDate);
          return {
            'Student Name': student.studentName,
            'Roll Number': student.rollNumber,
            'Assigned Class': assignedClass,
            'Department': getDeptName(student.department),
            'Email': student.email,
            'Date': targetDate,
            'Entry Time': log?.entryTime ? formatTime12hr(log.entryTime) : 'Absent',
            'Exit Time': log?.exitTime ? formatTime12hr(log.exitTime) : 'Absent',
            'Overall Status': log?.overallStatus || 'Absent'
          };
        });
      } else {
        const daysCount = reportType === 'weekly' ? 7 : 30;
        const today = new Date();
        const dateList: string[] = [];
        for (let i = 0; i < daysCount; i++) {
          const d = new Date();
          d.setDate(today.getDate() - i);
          dateList.push(d.toISOString().split('T')[0]);
        }

        exportData = targetStudents.map((student) => {
          const studentLogs = attendance.filter((a) => a.studentId === student.uid && dateList.includes(a.date));
          const presentDays = studentLogs.filter(l => l.overallStatus === 'Present' || l.overallStatus === 'Half Day').length;
          const absentDays = daysCount - presentDays;
          const percentage = daysCount > 0 ? Math.round((presentDays / daysCount) * 100) : 0;

          return {
            'Student Name': student.studentName,
            'Roll Number': student.rollNumber,
            'Assigned Class': assignedClass,
            'Department': getDeptName(student.department),
            'Email': student.email,
            'Days Analyzed': daysCount,
            'Present Days': presentDays,
            'Absent Days': absentDays,
            'Attendance Rate': `${percentage}%`
          };
        });
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportData);
      XLSX.utils.book_append_sheet(wb, ws, `Attendance_${reportType}`);
      XLSX.writeFile(wb, `${assignedClass}_Attendance_${reportType}_${targetDate}.xlsx`);
      success(`Classroom attendance exported to Excel (${reportType})!`);
    } catch (err: any) {
      console.error(err);
      error("Excel generation failed.");
    }
  };

  // EXPORT TO PDF
  const handleExportPDF = () => {
    try {
      const pdf = new jsPDF();
      pdf.setFont('Helvetica', 'normal');
      
      // Header Banner
      pdf.setFillColor(109, 40, 217); // Violet-700
      pdf.rect(0, 0, 210, 40, 'F');
      
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(18);
      pdf.setFont('Helvetica', 'bold');
      pdf.text(`CLASS ATTENDANCE REPORT: ${assignedClass}`, 15, 18);
      
      pdf.setFontSize(10);
      pdf.setFont('Helvetica', 'normal');
      pdf.text(`Official Faculty Report  |  Scope: ${assignedClass}  |  Generated: ${new Date().toLocaleDateString()}`, 15, 28);

      // Metadata Info Box
      pdf.setTextColor(40, 40, 40);
      pdf.setFontSize(11);
      pdf.setFont('Helvetica', 'bold');
      pdf.text(`Period: ${reportType.toUpperCase()}`, 15, 55);
      pdf.text(`Assigned Class: ${assignedClass}`, 15, 62);
      pdf.text(`Department: ${getDeptName(staffDepartment)}`, 15, 69);

      const targetStudents = students.filter((s) => getStudentAssignedClass(s) === assignedClass);

      pdf.setDrawColor(200, 200, 200);
      pdf.line(15, 75, 195, 75);

      if (reportType === 'daily') {
        pdf.setFont('Helvetica', 'bold');
        pdf.text('Roll No', 15, 81);
        pdf.text('Student Name', 45, 81);
        pdf.text('Entry', 105, 81);
        pdf.text('Exit', 140, 81);
        pdf.text('Status', 170, 81);
        pdf.line(15, 85, 195, 85);

        pdf.setFont('Helvetica', 'normal');
        let currentY = 91;

        targetStudents.forEach((student) => {
          if (currentY > 275) {
            pdf.addPage();
            currentY = 20;
          }
          const log = attendance.find((a) => a.studentId === student.uid && a.date === targetDate);
          
          pdf.text(student.rollNumber, 15, currentY);
          pdf.text(student.studentName.slice(0, 24), 45, currentY);
          pdf.text(log?.entryTime ? formatTime12hr(log.entryTime) : 'Absent', 105, currentY);
          pdf.text(log?.exitTime ? formatTime12hr(log.exitTime) : 'Absent', 140, currentY);
          pdf.text(log?.overallStatus || 'Absent', 170, currentY);
          
          pdf.line(15, currentY + 4, 195, currentY + 4);
          currentY += 10;
        });
      } else {
        pdf.setFont('Helvetica', 'bold');
        pdf.text('Roll No', 15, 81);
        pdf.text('Student Name', 45, 81);
        pdf.text('Days Analyzed', 105, 81);
        pdf.text('Present Days', 140, 81);
        pdf.text('Rate (%)', 170, 81);
        pdf.line(15, 85, 195, 85);

        pdf.setFont('Helvetica', 'normal');
        let currentY = 91;

        const daysCount = reportType === 'weekly' ? 7 : 30;
        const today = new Date();
        const dateList: string[] = [];
        for (let i = 0; i < daysCount; i++) {
          const d = new Date();
          d.setDate(today.getDate() - i);
          dateList.push(d.toISOString().split('T')[0]);
        }

        targetStudents.forEach((student) => {
          if (currentY > 275) {
            pdf.addPage();
            currentY = 20;
          }
          const studentLogs = attendance.filter((a) => a.studentId === student.uid && dateList.includes(a.date));
          const presentDays = studentLogs.filter(l => l.overallStatus === 'Present' || l.overallStatus === 'Half Day').length;
          const percentage = daysCount > 0 ? Math.round((presentDays / daysCount) * 100) : 0;

          pdf.text(student.rollNumber, 15, currentY);
          pdf.text(student.studentName.slice(0, 24), 45, currentY);
          pdf.text(String(daysCount), 105, currentY);
          pdf.text(String(presentDays), 140, currentY);
          pdf.text(`${percentage}%`, 170, currentY);
          
          pdf.line(15, currentY + 4, 195, currentY + 4);
          currentY += 10;
        });
      }

      pdf.save(`${assignedClass}_Attendance_Report_${targetDate}.pdf`);
      success(`Attendance report exported to PDF!`);
    } catch (err: any) {
      console.error(err);
      error("PDF generation failed.");
    }
  };

  // Staff action: Override Status
  const handleReviewStatus = async (recordId: string, status: 'Present' | 'Half Day' | 'Absent') => {
    try {
      const recordRef = doc(db, 'attendance', recordId);
      await updateDoc(recordRef, {
        overallStatus: status
      });
      success("Attendance status updated successfully!");
      await loadData();
    } catch (err: any) {
      console.error(err);
      error("Database update error.");
    }
  };

  const getStatusColorClass = (status: string) => {
    switch (status) {
      case 'Present': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
      case 'Half Day': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      case 'Needs Staff Review': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
      default: return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
    }
  };

  // Profile Save
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      error("Name cannot be empty.");
      return;
    }

    setIsSavingProfile(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("No authenticated user session.");

      const staffRef = doc(db, 'staffs', uid);
      const staffRefLegacy = doc(db, 'staff', uid);
      const userRef = doc(db, 'users', uid);

      await updateDoc(staffRef, {
        fullName: editName,
        staffName: editName
      }).catch(() => {});

      await updateDoc(staffRefLegacy, {
        fullName: editName,
        staffName: editName
      }).catch(() => {});

      await updateDoc(userRef, {
        name: editName
      });

      if (auth.currentUser) {
        await authUpdateProfile(auth.currentUser, {
          displayName: editName
        });
      }

      await refreshProfile();
      success("Staff profile updated successfully!");
    } catch (err: any) {
      console.error(err);
      error(err.message || "Failed to update profile.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Password Change
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || !confirmNewPassword) {
      error("Please fill in both password fields.");
      return;
    }

    if (newPassword !== confirmNewPassword) {
      error("Passwords do not match.");
      return;
    }

    if (newPassword.length < 6) {
      error("Password must be at least 6 characters.");
      return;
    }

    setIsChangingPassword(true);
    try {
      if (auth.currentUser) {
        await updatePassword(auth.currentUser, newPassword);
        setNewPassword('');
        setConfirmNewPassword('');
        success("Password updated successfully!");
      } else {
        throw new Error("No active session.");
      }
    } catch (err: any) {
      console.error(err);
      error(err.message || "Failed to update password. You may need to re-authenticate.");
    } finally {
      setIsChangingPassword(false);
    }
  };

  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
    JSON.stringify({ classId: assignedClass, date: targetDate, timestamp: Date.now() })
  )}&size=240x240`;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-col transition-colors duration-300">
      <Header title="Staff Command Center" />

      {/* Stats Cards Band */}
      <section className="max-w-7xl w-full mx-auto px-4 md:px-6 mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-3xl shadow-md flex items-center gap-4">
          <div className="p-3 bg-violet-500/10 text-violet-500 rounded-2xl border border-violet-500/20 shrink-0">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono">
              Class Students ({assignedClass})
            </p>
            <h4 className="text-2xl font-bold mt-0.5">{loading ? '--' : totalInScope}</h4>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-3xl shadow-md flex items-center gap-4">
          <div className="p-3 bg-emerald-500/10 text-emerald-500 rounded-2xl border border-emerald-500/20 shrink-0">
            <CheckSquare className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono">Present Today</p>
            <h4 className="text-2xl font-bold mt-0.5">{loading ? '--' : presentToday}</h4>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-3xl shadow-md flex items-center gap-4">
          <div className="p-3 bg-rose-500/10 text-rose-500 rounded-2xl border border-rose-500/20 shrink-0">
            <XCircle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono">Absent List</p>
            <h4 className="text-2xl font-bold mt-0.5">{loading ? '--' : absentToday}</h4>
          </div>
        </div>
      </section>

      {/* Main Console Layout */}
      <div className="max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        
        {/* Navigation Sidebar Drawer */}
        <aside className="lg:col-span-3 flex flex-col gap-4">
          <nav className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-3xl shadow-md flex flex-col gap-1">
            <button
              onClick={() => setActiveTab('students')}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'students'
                  ? 'bg-violet-600/10 text-violet-600 dark:text-violet-400 border border-violet-500/10'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Users className="w-4 h-4" />
              Student Directory
            </button>

            <button
              onClick={() => setActiveTab('daily')}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'daily'
                  ? 'bg-violet-600/10 text-violet-600 dark:text-violet-400 border border-violet-500/10'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <ClipboardList className="w-4 h-4" />
              Attendance Control
            </button>

            <button
              onClick={() => setActiveTab('monthly')}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'monthly'
                  ? 'bg-violet-600/10 text-violet-600 dark:text-violet-400 border border-violet-500/10'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <BarChart2 className="w-4 h-4" />
              Compliance Analytics
            </button>

            <button
              onClick={() => setActiveTab('profile')}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'profile'
                  ? 'bg-violet-600/10 text-violet-600 dark:text-violet-400 border border-violet-500/10'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <User className="w-4 h-4" />
              Staff Profile
            </button>
          </nav>

          {/* Read-Only Assigned Class Info Box */}
          {activeTab !== 'profile' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-3xl shadow-md space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs uppercase tracking-widest text-slate-400 font-mono flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" /> Class Assignment
                </h4>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20">
                  Locked
                </span>
              </div>
              
              <div className="bg-slate-50 dark:bg-slate-950 p-3.5 rounded-2xl border border-slate-200/60 dark:border-slate-800 space-y-2">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-mono block">Assigned Class</span>
                  <span className="text-base font-extrabold text-violet-600 dark:text-violet-400">
                    {assignedClass}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-mono block">Department</span>
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {getDeptName(staffDepartment)}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-mono block">Staff Authority</span>
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {staffProfile?.fullName || staffProfile?.staffName || userProfile?.name || 'Faculty Member'}
                  </span>
                </div>
              </div>

              {/* Target Date Selector */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" /> Calendar Log Date
                </label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 bg-slate-50 dark:bg-slate-950 focus:ring-2 focus:ring-violet-500 focus:outline-none"
                />
              </div>

              {/* Refresh Button */}
              <button
                onClick={loadData}
                disabled={loading}
                className="w-full flex justify-center items-center gap-2 py-2.5 px-4 border border-transparent rounded-xl text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 transition-all shadow-md cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Sync Class Records
              </button>
            </div>
          )}
        </aside>

        {/* Console Workspace Display */}
        <main className="lg:col-span-9 flex flex-col gap-6">
          <AnimatePresence mode="wait">
            
            {/* TAB 1: STUDENT DIRECTORY */}
            {activeTab === 'students' && (
              <motion.div
                key="students"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-lg space-y-6"
              >
                {/* Search Bar */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
                      Classroom Directory <span className="text-xs px-2.5 py-1 bg-violet-500/10 text-violet-600 dark:text-violet-400 rounded-full font-mono">{assignedClass}</span>
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Students enrolled in assigned class ({assignedClass}).
                    </p>
                  </div>
                  
                  <div className="relative w-full md:max-w-xs">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search name or roll..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full text-xs pl-9 pr-4 py-2.5 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>
                </div>

                {loading ? (
                  <div className="text-center py-12 text-slate-400">
                    <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-violet-500" />
                    <span className="text-xs">Accessing databanks...</span>
                  </div>
                ) : filteredStudents.length === 0 ? (
                  <div className="text-center py-16 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-slate-400 text-xs">
                    No students registered in class {assignedClass}.
                  </div>
                ) : (
                  <div className="overflow-x-auto animate-fade-in">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 font-mono uppercase tracking-wider">
                          <th className="pb-3 font-semibold">Student Name</th>
                          <th className="pb-3 font-semibold">Roll Number</th>
                          <th className="pb-3 font-semibold">Assigned Class</th>
                          <th className="pb-3 font-semibold">Enrollment Status</th>
                          <th className="pb-3 font-semibold">Avg Attendance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStudents.map((s) => (
                          <tr key={s.studentId} className="border-b border-slate-100/50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                            <td className="py-4 font-semibold flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center text-slate-400 shrink-0">
                                {s.photoURL ? (
                                  <img src={s.photoURL} alt="Avatar" className="w-full h-full object-cover text-[0px]" referrerPolicy="no-referrer" />
                                ) : (
                                  <Users className="w-4 h-4" />
                                )}
                              </div>
                              <div>
                                <span className="text-slate-800 dark:text-slate-200 font-bold block">{s.studentName}</span>
                                <span className="text-[10px] text-slate-400 font-medium block">{s.email}</span>
                              </div>
                            </td>
                            <td className="py-4 font-mono font-medium text-slate-500">{s.rollNumber}</td>
                            <td className="py-4 text-slate-600 dark:text-slate-300 font-bold">{assignedClass}</td>
                            <td className="py-4">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold ${
                                s.faceRegistered 
                                  ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' 
                                  : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                              }`}>
                                <div className={`w-1.5 h-1.5 rounded-full ${s.faceRegistered ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                                {s.faceRegistered ? 'Face Registered' : 'Missing Template'}
                              </span>
                            </td>
                            <td className="py-4 font-bold text-slate-800 dark:text-slate-200">{s.attendancePercentage}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.div>
            )}

            {/* TAB 2: DAILY ATTENDANCE CONTROL */}
            {activeTab === 'daily' && (
              <motion.div
                key="daily"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-lg space-y-6"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
                      Attendance Logs ({assignedClass}) <span className="text-xs font-mono text-slate-400">{targetDate}</span>
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Review, override, and compile attendance for {assignedClass}.</p>
                  </div>

                  <div className="flex flex-wrap gap-2 items-center">
                    <button
                      onClick={() => setShowQRModal(true)}
                      className="px-3.5 py-2 border border-violet-500/30 rounded-xl bg-violet-600 text-white font-bold flex items-center gap-1.5 hover:bg-violet-500 transition-all text-xs cursor-pointer shadow-md shadow-violet-600/20"
                    >
                      <QrCode className="w-4 h-4" /> Class QR Code
                    </button>

                    <select 
                      value={reportType}
                      onChange={(e) => setReportType(e.target.value as any)}
                      className="text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-2 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-bold focus:outline-none"
                    >
                      <option value="daily">Daily Report</option>
                      <option value="weekly">Weekly Summary</option>
                      <option value="monthly">Monthly Summary</option>
                    </select>

                    <button
                      onClick={handleExportExcel}
                      className="px-3.5 py-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-bold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all text-xs cursor-pointer"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-500" /> Excel
                    </button>

                    <button
                      onClick={handleExportPDF}
                      className="px-3.5 py-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-bold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all text-xs cursor-pointer"
                    >
                      <FileText className="w-4 h-4 text-rose-500" /> PDF
                    </button>
                  </div>
                </div>

                {loading ? (
                  <div className="text-center py-12 text-slate-400">
                    <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-violet-500" />
                    <span className="text-xs">Fetching attendance logs for {assignedClass}...</span>
                  </div>
                ) : dailyAttendanceReport.length === 0 ? (
                  <div className="text-center py-16 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-slate-400 text-xs">
                    No students listed in assigned class {assignedClass}.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 font-mono uppercase tracking-wider">
                          <th className="pb-3 font-semibold">Student Name</th>
                          <th className="pb-3 font-semibold">Roll Number</th>
                          <th className="pb-3 font-semibold">Entry Time</th>
                          <th className="pb-3 font-semibold">Exit Time</th>
                          <th className="pb-3 font-semibold">Status</th>
                          <th className="pb-3 text-right">Faculty Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyAttendanceReport.map(({ student, log }) => {
                          const status = log?.overallStatus || 'Absent';
                          return (
                            <tr key={student.studentId} className="border-b border-slate-100/50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                              <td className="py-4 font-bold text-slate-800 dark:text-slate-200">
                                {student.studentName}
                              </td>
                              <td className="py-4 font-mono text-slate-500">{student.rollNumber}</td>
                              <td className="py-4 font-mono text-slate-600 dark:text-slate-400">
                                {log?.entryTime ? formatTime12hr(log.entryTime) : '--:--'}
                              </td>
                              <td className="py-4 font-mono text-slate-600 dark:text-slate-400">
                                {log?.exitTime ? formatTime12hr(log.exitTime) : '--:--'}
                              </td>
                              <td className="py-4">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold ${getStatusColorClass(status)}`}>
                                  {status}
                                </span>
                              </td>
                              <td className="py-4 text-right">
                                <div className="inline-flex gap-1.5 justify-end">
                                  <button
                                    onClick={() => handleReviewStatus(log?.attendanceId || `${student.uid}_${targetDate}`, 'Present')}
                                    className="px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-lg text-[10px] font-bold cursor-pointer transition-all"
                                  >
                                    Present
                                  </button>
                                  <button
                                    onClick={() => handleReviewStatus(log?.attendanceId || `${student.uid}_${targetDate}`, 'Half Day')}
                                    className="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-lg text-[10px] font-bold cursor-pointer transition-all"
                                  >
                                    Half Day
                                  </button>
                                  <button
                                    onClick={() => handleReviewStatus(log?.attendanceId || `${student.uid}_${targetDate}`, 'Absent')}
                                    className="px-2 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 rounded-lg text-[10px] font-bold cursor-pointer transition-all"
                                  >
                                    Absent
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.div>
            )}

            {/* TAB 3: COMPLIANCE ANALYTICS */}
            {activeTab === 'monthly' && (
              <motion.div
                key="monthly"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-lg space-y-6"
              >
                <div>
                  <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
                    Classroom Compliance Analytics <span className="text-xs font-mono text-slate-400">{assignedClass}</span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Classroom attendance trends and audit metrics for {assignedClass}.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl space-y-3">
                    <h3 className="font-bold text-xs uppercase tracking-widest text-slate-400 font-mono">Assigned Class Summary</h3>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between py-1.5 border-b border-slate-200/50 dark:border-slate-800/50">
                        <span className="text-slate-500">Target Assigned Class</span>
                        <span className="font-bold text-violet-600 dark:text-violet-400">{assignedClass}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-200/50 dark:border-slate-800/50">
                        <span className="text-slate-500">Total Enrolled Students</span>
                        <span className="font-bold text-slate-800 dark:text-slate-100">{totalInScope}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-200/50 dark:border-slate-800/50">
                        <span className="text-slate-500">Present Count ({targetDate})</span>
                        <span className="font-bold text-emerald-500">{presentToday}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-200/50 dark:border-slate-800/50">
                        <span className="text-slate-500">Absent Count ({targetDate})</span>
                        <span className="font-bold text-rose-500">{absentToday}</span>
                      </div>
                      <div className="flex justify-between py-1.5">
                        <span className="text-slate-500">Class Attendance Rate</span>
                        <span className="font-bold text-slate-800 dark:text-slate-100">
                          {totalInScope > 0 ? `${Math.round((presentToday / totalInScope) * 100)}%` : '0%'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl flex flex-col justify-between">
                    <h3 className="font-bold text-xs uppercase tracking-widest text-slate-400 font-mono">Quick Export Center</h3>
                    <p className="text-xs text-slate-500 my-3">Download complete attendance archives for class {assignedClass} in Excel or PDF format.</p>
                    <div className="flex gap-3">
                      <button
                        onClick={handleExportExcel}
                        className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all"
                      >
                        <FileSpreadsheet className="w-4 h-4" /> Export Excel
                      </button>
                      <button
                        onClick={handleExportPDF}
                        className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all"
                      >
                        <FileText className="w-4 h-4" /> Export PDF
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* TAB 4: STAFF PROFILE */}
            {activeTab === 'profile' && (
              <motion.div
                key="profile"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-lg space-y-6"
              >
                <div>
                  <h2 className="text-lg font-bold tracking-tight">Faculty Account Details</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Manage profile information and security credentials.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Edit Profile Form */}
                  <form onSubmit={handleSaveProfile} className="bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl space-y-4">
                    <h3 className="font-bold text-xs uppercase tracking-widest text-slate-400 font-mono">Profile Details</h3>

                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Full Name</label>
                      <input
                        type="text"
                        required
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Staff ID</label>
                      <input
                        type="text"
                        disabled
                        value={staffProfile?.staffId || userProfile?.uid || ''}
                        className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-slate-100 dark:bg-slate-900 text-slate-500 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Assigned Class (Locked)</label>
                      <input
                        type="text"
                        disabled
                        value={`${assignedClass} (${getDeptName(staffDepartment)})`}
                        className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-slate-100 dark:bg-slate-900 text-violet-600 dark:text-violet-400 font-bold"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isSavingProfile}
                      className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-semibold text-xs transition-all cursor-pointer shadow-md"
                    >
                      {isSavingProfile ? 'Saving...' : 'Save Profile Changes'}
                    </button>
                  </form>

                  {/* Change Password Form */}
                  <form onSubmit={handleChangePassword} className="bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl space-y-4">
                    <h3 className="font-bold text-xs uppercase tracking-widest text-slate-400 font-mono">Security Credentials</h3>

                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">New Password</label>
                      <input
                        type="password"
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Confirm New Password</label>
                      <input
                        type="password"
                        required
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isChangingPassword}
                      className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-semibold text-xs transition-all cursor-pointer shadow-md"
                    >
                      {isChangingPassword ? 'Updating...' : 'Update Password'}
                    </button>
                  </form>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </main>
      </div>

      {/* Class QR Code Modal */}
      {showQRModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl"
          >
            <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <QrCode className="w-5 h-5 text-violet-500" /> Class QR Code
              </h3>
              <button
                onClick={() => setShowQRModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Students in <strong className="text-violet-600 dark:text-violet-400">{assignedClass}</strong> can scan this QR code to mark attendance for <span className="font-mono">{targetDate}</span>.
            </p>

            <div className="p-4 bg-white rounded-2xl border border-slate-200 flex justify-center shadow-inner">
              <img src={qrCodeUrl} alt="Class QR Code" className="w-48 h-48 object-contain" />
            </div>

            <div className="pt-2">
              <button
                onClick={() => setShowQRModal(false)}
                className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-semibold cursor-pointer"
              >
                Close QR Code
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default StaffDashboard;
