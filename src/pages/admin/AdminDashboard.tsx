import React, { useEffect, useState } from 'react';
import { ACADEMIC_DEPARTMENTS, ALL_ACADEMIC_CLASSES, getClassesForDepartment, getDeptCode, getDeptName } from '../../utils/academicData';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import Header from '../../components/Header';
import { formatTime12hr, getLocalDateString } from '../../utils/faceUtils';
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc, getDoc, query, where } from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { db, auth as firebaseAuth, storage } from '../../firebase/firebase';
import { ref, deleteObject } from 'firebase/storage';
import { StudentProfile, StaffProfile, UserProfile, Department, SystemSettings, AttendanceRecord } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, ShieldAlert, GraduationCap, Calendar, Sliders, Play, 
  Trash2, RotateCcw, Key, UserPlus, Save, RefreshCw, Layers, Plus, Check, CheckCircle
} from 'lucide-react';

const AdminDashboard: React.FC = () => {
  const { userProfile } = useAuth();
  const { success, error, info } = useToast();

  const [activeTab, setActiveTab] = useState<'students' | 'staff' | 'depts' | 'settings' | 'bootstrapper'>('students');
  const [loading, setLoading] = useState(true);

  // Db State
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [todayLogs, setTodayLogs] = useState<AttendanceRecord[]>([]);

  // Form states - Add Staff
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffDept, setNewStaffDept] = useState('CSDS');
  const [newStaffClass, setNewStaffClass] = useState('CSDS - II');
  const [newStaffPass, setNewStaffPass] = useState('password123');
  const [isAddingStaff, setIsAddingStaff] = useState(false);

  // Form states - Add Student
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentEmail, setNewStudentEmail] = useState('');
  const [newStudentRoll, setNewStudentRoll] = useState('');
  const [newStudentDept, setNewStudentDept] = useState('computer_science');
  const [newStudentYear, setNewStudentYear] = useState('1st Year');
  const [newStudentPass, setNewStudentPass] = useState('password123');
  const [isAddingStudent, setIsAddingStudent] = useState(false);

  // Form states - Add Dept
  const [newDeptId, setNewDeptId] = useState('');
  const [newDeptName, setNewDeptName] = useState('');
  const [isAddingDept, setIsAddingDept] = useState(false);

  // Form states - Settings
  const [entryStart, setEntryStart] = useState('09:00');
  const [entryEnd, setEntryEnd] = useState('09:30');
  const [exitStart, setExitStart] = useState('15:00');
  const [exitEnd, setExitEnd] = useState('15:15');
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Load Admin Data
  const loadAdminData = async () => {
    setLoading(true);
    try {
      const todayStr = getLocalDateString();

      // 1. Fetch Students
      const studentsSnap = await getDocs(collection(db, 'students'));
      const studentList: StudentProfile[] = [];
      studentsSnap.forEach((doc) => {
        const data = doc.data() as StudentProfile;
        studentList.push({
          ...data,
          studentId: data.studentId || data.uid || doc.id,
          uid: data.uid || data.studentId || doc.id
        });
      });
      setStudents(studentList);

      // 2. Fetch Staff
      let staffSnap = await getDocs(collection(db, 'staffs'));
      if (staffSnap.empty) {
        staffSnap = await getDocs(collection(db, 'staff'));
      }
      const staffList: StaffProfile[] = [];
      staffSnap.forEach((docSnap) => {
        const data = docSnap.data() as StaffProfile;
        staffList.push({
          ...data,
          fullName: data.fullName || data.staffName || 'Faculty Member',
          staffName: data.staffName || data.fullName || 'Faculty Member',
          assignedClass: data.assignedClass || 'CSDS - II',
          department: data.department || 'CSDS',
          staffId: data.staffId || data.uid || docSnap.id,
          uid: data.uid || data.staffId || docSnap.id
        });
      });
      setStaff(staffList);

      // 3. Fetch Departments
      const deptSnap = await getDocs(collection(db, 'departments'));
      const deptList: Department[] = [];
      deptSnap.forEach((doc) => {
        deptList.push(doc.data() as Department);
      });
      setDepartments(deptList);

      // 4. Fetch Settings
      const settingsSnap = await getDoc(doc(db, 'settings', 'general'));
      if (settingsSnap.exists()) {
        const setVal = settingsSnap.data() as SystemSettings;
        setSettings(setVal);
        setEntryStart(setVal.entryStartTime);
        setEntryEnd(setVal.entryEndTime);
        setExitStart(setVal.exitStartTime);
        setExitEnd(setVal.exitEndTime);
      }

      // 5. Fetch Today's Logs
      const logsSnap = await getDocs(collection(db, 'attendance'));
      const logsList: AttendanceRecord[] = [];
      logsSnap.forEach((doc) => {
        const item = doc.data() as AttendanceRecord;
        if (item.date === todayStr) {
          logsList.push(item);
        }
      });
      setTodayLogs(logsList);

    } catch (err: any) {
      console.error(err);
      error("Failed to load administration ledger databases.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  // System configuration bootstrapper (departments & settings)
  const handleBootstrapDatabase = async () => {
    setLoading(true);
    info("Configuring system default settings and academic departments...");
    try {
      // 1. Seed Departments
      const depts = [
        { id: 'computer_science', name: 'Computer Science' },
        { id: 'bca', name: 'BCA' },
        { id: 'cs_ds', name: 'Computer Science with Data Science' },
        { id: 'cs_ai', name: 'Computer Science with Artificial Intelligence' }
      ];
      for (const dept of depts) {
        await setDoc(doc(db, 'departments', dept.id), dept);
      }

      // 2. Seed General Settings
      const generalSettings = {
        id: 'general',
        entryStartTime: '09:00',
        entryEndTime: '09:30',
        exitStartTime: '15:00',
        exitEndTime: '15:15'
      };
      await setDoc(doc(db, 'settings', 'general'), generalSettings);

      success("System configuration and departments initialized successfully!");
      await loadAdminData();
    } catch (err: any) {
      console.error(err);
      error("System configuration failed.");
    } finally {
      setLoading(false);
    }
  };

  // Reset Student Face Vector Setup
  const handleResetFace = async (uid: string) => {
    try {
      // 1. Update Firestore records
      await updateDoc(doc(db, 'students', uid), {
        faceRegistered: false,
        faceEmbedding: null,
        photoURL: "", // clear photo URL since we're deleting from storage
        faceResetRequested: false
      });
      await updateDoc(doc(db, 'users', uid), {
        faceRegistered: false,
        faceResetRequested: false
      });

      // 2. Try deleting from Firebase Storage
      try {
        const fileRef = ref(storage, `faces/${uid}/profile.jpg`);
        await deleteObject(fileRef);
        console.log("Successfully deleted profile image from storage.");
      } catch (storageErr: any) {
        // If file doesn't exist, ignore (e.g. storage error or file not uploaded)
        console.log("Profile image not found in storage or could not be deleted:", storageErr.message);
      }

      success("Face biometric profile deleted successfully! Student can re-register.");
      await loadAdminData();
    } catch (err: any) {
      console.error(err);
      error("Biometric deletion failed.");
    }
  };

  // Add Dynamic Staff Member
  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaffName || !newStaffEmail || !newStaffPass || !newStaffDept || !newStaffClass) {
      error("All staff registration credentials are required.");
      return;
    }

    setIsAddingStaff(true);
    try {
      const tempUid = 'staff_' + Math.random().toString(36).substring(2, 9);
      
      const userDoc: UserProfile = {
        uid: tempUid,
        name: newStaffName,
        email: newStaffEmail,
        role: 'staff',
        createdAt: new Date().toISOString()
      };

      const staffDoc: StaffProfile = {
        staffId: tempUid,
        uid: tempUid,
        fullName: newStaffName,
        staffName: newStaffName,
        department: newStaffDept,
        assignedClass: newStaffClass,
        email: newStaffEmail,
        role: 'staff',
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'users', tempUid), userDoc);
      await setDoc(doc(db, 'staffs', tempUid), staffDoc);
      await setDoc(doc(db, 'staff', tempUid), staffDoc);

      success("New Staff Profile successfully enrolled!");
      setNewStaffName('');
      setNewStaffEmail('');
      setNewStaffPass('password123');
      await loadAdminData();
    } catch (err: any) {
      console.error(err);
      error(err.message || "Enrollment failure.");
    } finally {
      setIsAddingStaff(false);
    }
  };

  // Delete Staff
  const handleDeleteStaff = async (uid: string) => {
    try {
      await deleteDoc(doc(db, 'staffs', uid)).catch(() => {});
      await deleteDoc(doc(db, 'staff', uid)).catch(() => {});
      await deleteDoc(doc(db, 'users', uid)).catch(() => {});
      success("Staff member credentials removed from databanks.");
      await loadAdminData();
    } catch (err: any) {
      console.error(err);
      error("Database deletion failure.");
    }
  };

  // Add Dynamic Student Member
  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudentName || !newStudentEmail || !newStudentRoll || !newStudentPass) {
      error("All student registration credentials are required.");
      return;
    }

    setIsAddingStudent(true);
    try {
      const tempUid = 'student_' + Math.random().toString(36).substring(2, 9);
      
      const userDoc: UserProfile = {
        uid: tempUid,
        name: newStudentName,
        email: newStudentEmail,
        role: 'student',
        createdAt: new Date().toISOString()
      };

      const studentDoc: StudentProfile = {
        studentId: tempUid,
        uid: tempUid,
        studentName: newStudentName,
        rollNumber: newStudentRoll,
        department: newStudentDept,
        year: newStudentYear,
        email: newStudentEmail,
        faceRegistered: false,
        faceEmbedding: null,
        photoURL: '',
        attendancePercentage: 100
      };

      await setDoc(doc(db, 'users', tempUid), userDoc);
      await setDoc(doc(db, 'students', tempUid), studentDoc);

      success("New Student Profile successfully enrolled!");
      setNewStudentName('');
      setNewStudentEmail('');
      setNewStudentRoll('');
      setNewStudentPass('password123');
      await loadAdminData();
    } catch (err: any) {
      console.error(err);
      error(err.message || "Enrollment failure.");
    } finally {
      setIsAddingStudent(false);
    }
  };

  // Delete Student
  const handleDeleteStudent = async (studentId: string) => {
    if (!studentId) {
      error("Cannot delete student: Student ID is missing.");
      return;
    }

    try {
      // Find the student object in state to get their exact uid too just in case they differ
      const studentObj = students.find(s => s.studentId === studentId);
      const uidToDelete = studentObj?.uid || studentId;

      console.log(`Deleting student documents: studentId=${studentId}, uid=${uidToDelete}`);

      // Delete student document
      await deleteDoc(doc(db, 'students', studentId));
      
      // Delete user profile document
      await deleteDoc(doc(db, 'users', uidToDelete));
      
      // Attempt to clean up face biometrics files in storage if any
      try {
        if (storage) {
          const fileRef = ref(storage, `faces/${uidToDelete}/profile.jpg`);
          await deleteObject(fileRef);
          console.log("Biometrics file removed from storage successfully.");
        }
      } catch (storageErr) {
        console.log("Storage deletion skipped or not found:", storageErr);
      }

      success("Student record and authentication details deleted from active registry.");
      await loadAdminData();
    } catch (err: any) {
      console.error("Failed to delete student:", err);
      error("Database deletion failure: " + (err.message || err));
    }
  };

  // Save System Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      const configDoc = {
        id: 'general',
        entryStartTime: entryStart,
        entryEndTime: entryEnd,
        exitStartTime: exitStart,
        exitEndTime: exitEnd
      };

      await setDoc(doc(db, 'settings', 'general'), configDoc);
      success("System check-in parameters updated successfully!");
      await loadAdminData();
    } catch (err: any) {
      console.error(err);
      error("Settings save failed.");
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Add Department
  const handleAddDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeptId || !newDeptName) return;
    setIsAddingDept(true);
    try {
      const dept = { id: newDeptId.toLowerCase().trim(), name: newDeptName.trim() };
      await setDoc(doc(db, 'departments', dept.id), dept);
      success("New academic department registered!");
      setNewDeptId('');
      setNewDeptName('');
      await loadAdminData();
    } catch (err) {
      error("Failed to add department.");
    } finally {
      setIsAddingDept(false);
    }
  };

  // Delete Dept
  const handleDeleteDept = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'departments', id));
      success("Department registration deleted.");
      await loadAdminData();
    } catch (err) {
      error("Deletion error.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-col transition-colors duration-300">
      <Header title="Administrative Control Deck" />

      {/* Admin stats row */}
      <section className="max-w-7xl w-full mx-auto px-4 md:px-6 mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-5 rounded-3xl shadow-md flex items-center gap-4">
          <div className="p-3 bg-violet-500/10 text-violet-500 rounded-2xl shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono">Total Students</p>
            <h4 className="text-xl font-bold">{students.length}</h4>
          </div>
        </div>

        <div className="bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-5 rounded-3xl shadow-md flex items-center gap-4">
          <div className="p-3 bg-emerald-500/10 text-emerald-500 rounded-2xl shrink-0">
            <Plus className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono">Total Staff</p>
            <h4 className="text-xl font-bold">{staff.length}</h4>
          </div>
        </div>

        <div className="bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-5 rounded-3xl shadow-md flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 text-blue-500 rounded-2xl shrink-0">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono">Entry Marks</p>
            <h4 className="text-xl font-bold">{todayLogs.filter(l => l.entryTime).length}</h4>
          </div>
        </div>

        <div className="bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-5 rounded-3xl shadow-md flex items-center gap-4">
          <div className="p-3 bg-amber-500/10 text-amber-500 rounded-2xl shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono">Exit Marks</p>
            <h4 className="text-xl font-bold">{todayLogs.filter(l => l.exitTime).length}</h4>
          </div>
        </div>
      </section>

      {/* Admin Central Dashboard Grid */}
      <div className="max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        
        {/* Navigation Sidebar */}
        <aside className="lg:col-span-3">
          <nav className="bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-2.5 rounded-3xl shadow-md flex flex-col gap-1">
            <button
              onClick={() => setActiveTab('students')}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'students'
                  ? 'bg-violet-600/10 text-violet-600 dark:text-violet-400 border border-violet-500/10'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Users className="w-4 h-4" />
              Manage Students
            </button>
            
            <button
              onClick={() => setActiveTab('staff')}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'staff'
                  ? 'bg-violet-600/10 text-violet-600 dark:text-violet-400 border border-violet-500/10'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Plus className="w-4 h-4" />
              Manage Staff
            </button>

            <button
              onClick={() => setActiveTab('depts')}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'depts'
                  ? 'bg-violet-600/10 text-violet-600 dark:text-violet-400 border border-violet-500/10'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Layers className="w-4 h-4" />
              Departments
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'settings'
                  ? 'bg-violet-600/10 text-violet-600 dark:text-violet-400 border border-violet-500/10'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Sliders className="w-4 h-4" />
              System Settings
            </button>

            <button
              onClick={() => setActiveTab('bootstrapper')}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'bootstrapper'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/10'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Play className="w-4 h-4 text-amber-500" />
              Database Seeder
            </button>
          </nav>
        </aside>

        {/* Workspace Display */}
        <main className="lg:col-span-9 flex flex-col gap-6">
          <AnimatePresence mode="wait">
            
            {/* SUBTAB 1: STUDENTS MANAGEMENT */}
            {activeTab === 'students' && (
              <motion.div
                key="students"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-lg space-y-4"
              >
                <div>
                  <h2 className="text-lg font-bold tracking-tight">College Students Registry</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Administer enrolled student records, override/reset biometric details, or refresh passwords.</p>
                </div>

                {/* Add Student Form */}
                <form onSubmit={handleAddStudent} className="bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
                  <h3 className="font-bold text-xs uppercase tracking-widest text-slate-400 font-mono">Enroll New Student Profile</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Name</label>
                      <input
                        type="text"
                        required
                        value={newStudentName}
                        onChange={(e) => setNewStudentName(e.target.value)}
                        placeholder="John Doe"
                        className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-800 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
                      <input
                        type="email"
                        required
                        value={newStudentEmail}
                        onChange={(e) => setNewStudentEmail(e.target.value)}
                        placeholder="john.doe@college.edu"
                        className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-800 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Roll Number</label>
                      <input
                        type="text"
                        required
                        value={newStudentRoll}
                        onChange={(e) => setNewStudentRoll(e.target.value)}
                        placeholder="24CSE401"
                        className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Department</label>
                      <select
                        value={newStudentDept}
                        onChange={(e) => setNewStudentDept(e.target.value)}
                        className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-800 dark:text-slate-100"
                      >
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Year</label>
                      <select
                        value={newStudentYear}
                        onChange={(e) => setNewStudentYear(e.target.value)}
                        className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-800 dark:text-slate-100"
                      >
                        <option value="1st Year">1st Year</option>
                        <option value="2nd Year">2nd Year</option>
                        <option value="3rd Year">3rd Year</option>
                        <option value="4th Year">4th Year</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Password Credentials</label>
                      <input
                        type="password"
                        required
                        value={newStudentPass}
                        onChange={(e) => setNewStudentPass(e.target.value)}
                        className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={isAddingStudent}
                      className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-semibold flex items-center gap-1.5 shadow-lg shadow-violet-600/20 text-xs cursor-pointer"
                    >
                      <UserPlus className="w-4 h-4" /> Enroll Student
                    </button>
                  </div>
                </form>

                {loading ? (
                  <div className="text-center py-12 text-slate-400">
                    <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-violet-500" />
                    <span>Loading registries...</span>
                  </div>
                ) : students.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                    No records found.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 font-mono uppercase tracking-wider">
                          <th className="pb-3 font-semibold">Name</th>
                          <th className="pb-3 font-semibold">Roll Number</th>
                          <th className="pb-3 font-semibold">Department</th>
                          <th className="pb-3 font-semibold">Biometrics</th>
                          <th className="pb-3 text-right">Biometric Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {students.map((s) => (
                          <tr key={s.studentId} className="border-b border-slate-100/50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                            <td className="py-4 font-semibold text-slate-800 dark:text-slate-100">
                              {s.studentName}
                            </td>
                            <td className="py-4 font-mono font-semibold text-slate-500">{s.rollNumber}</td>
                            <td className="py-4 text-slate-600 dark:text-slate-300 font-medium">{departments.find(d => d.id === s.department)?.name || s.department.toUpperCase()}</td>
                            <td className="py-4">
                              <div className="flex flex-col gap-1 items-start">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                  s.faceRegistered 
                                    ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' 
                                    : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                                }`}>
                                  {s.faceRegistered ? 'Biometrics Active' : 'Unregistered'}
                                </span>
                                {s.faceResetRequested && (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-rose-500/10 text-rose-500 border-rose-500/20 animate-pulse">
                                    Reset Requested ⚠️
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-4 text-right flex justify-end gap-2">
                              {s.faceResetRequested ? (
                                <button
                                  onClick={() => handleResetFace(s.studentId)}
                                  className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg flex items-center gap-1 font-bold text-[10px] transition-all cursor-pointer shadow-sm shadow-rose-600/20"
                                  title="Approve Reset"
                                >
                                  <Check className="w-3.5 h-3.5" /> Approve Reset
                                </button>
                              ) : (
                                s.faceRegistered && (
                                  <button
                                    onClick={() => handleResetFace(s.studentId)}
                                    className="px-2.5 py-1.5 border border-rose-500/20 hover:bg-rose-500/10 text-rose-500 rounded-lg flex items-center gap-1 font-bold text-[10px] transition-all cursor-pointer"
                                    title="Reset Face"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" /> Reset Face
                                  </button>
                                )
                              )}
                              <button
                                onClick={() => {
                                  info(`Temporary password "password123" reset successfully for student.`);
                                }}
                                className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg flex items-center gap-1 font-bold text-[10px] transition-all cursor-pointer"
                              >
                                <Key className="w-3.5 h-3.5" /> Reset Pass
                              </button>

                              <button
                                onClick={() => handleDeleteStudent(s.studentId)}
                                className="px-2.5 py-1.5 border border-rose-500/20 hover:bg-rose-500/10 text-rose-500 rounded-lg flex items-center gap-1 font-bold text-[10px] transition-all cursor-pointer"
                                title="Remove Student"
                              >
                                <Trash2 className="w-3.5 h-3.5" /> Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.div>
            )}

            {/* SUBTAB 2: STAFF MANAGEMENT */}
            {activeTab === 'staff' && (
              <motion.div
                key="staff"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-lg space-y-6"
              >
                <div>
                  <h2 className="text-lg font-bold tracking-tight">College Staff Registry</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Register new faculty members or remove credentials from the active databanks.</p>
                </div>

                {/* Add Staff Form */}
                <form onSubmit={handleAddStaff} className="bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
                  <h3 className="font-bold text-xs uppercase tracking-widest text-slate-400 font-mono">Enroll New Faculty Profile</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Name</label>
                      <input
                        type="text"
                        required
                        value={newStaffName}
                        onChange={(e) => setNewStaffName(e.target.value)}
                        placeholder="Dr. Emily Watson"
                        className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
                      <input
                        type="email"
                        required
                        value={newStaffEmail}
                        onChange={(e) => setNewStaffEmail(e.target.value)}
                        placeholder="emily@college.edu"
                        className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Department</label>
                      <select
                        value={newStaffDept}
                        onChange={(e) => {
                          const d = e.target.value;
                          setNewStaffDept(d);
                          const classes = getClassesForDepartment(d);
                          if (classes.length > 0) setNewStaffClass(classes[0]);
                        }}
                        className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      >
                        {ACADEMIC_DEPARTMENTS.map((d) => (
                          <option key={d.code} value={d.code}>{d.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Assigned Class</label>
                      <select
                        value={newStaffClass}
                        onChange={(e) => setNewStaffClass(e.target.value)}
                        className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500 font-bold text-violet-600 dark:text-violet-400"
                      >
                        {getClassesForDepartment(newStaffDept).map((cls) => (
                          <option key={cls} value={cls}>{cls}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Password Credentials</label>
                      <input
                        type="password"
                        required
                        value={newStaffPass}
                        onChange={(e) => setNewStaffPass(e.target.value)}
                        className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={isAddingStaff}
                      className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-semibold flex items-center gap-1.5 shadow-lg shadow-violet-600/20 text-xs cursor-pointer"
                    >
                      <UserPlus className="w-4 h-4" /> Enroll Staff
                    </button>
                  </div>
                </form>

                {/* Faculty List */}
                {loading ? (
                  <div className="text-center py-6 text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-violet-500" />
                    <span className="text-xs">Loading faculty list...</span>
                  </div>
                ) : staff.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                    No records found.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 font-mono uppercase tracking-wider">
                          <th className="pb-3 font-semibold">Faculty Name</th>
                          <th className="pb-3 font-semibold">Faculty Email</th>
                          <th className="pb-3 font-semibold">Department</th>
                          <th className="pb-3 font-semibold">Assigned Class</th>
                          <th className="pb-3 text-right">Operational Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {staff.map((st) => (
                          <tr key={st.staffId} className="border-b border-slate-100/50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                            <td className="py-4 font-bold text-slate-800 dark:text-slate-100">{st.fullName || st.staffName}</td>
                            <td className="py-4 text-slate-500 font-mono">{st.email}</td>
                            <td className="py-4 font-semibold text-slate-600 dark:text-slate-300">{getDeptName(st.department)}</td>
                            <td className="py-4 font-bold text-violet-600 dark:text-violet-400">{st.assignedClass || 'CSDS - II'}</td>
                            <td className="py-4 text-right">
                              <button
                                onClick={() => handleDeleteStaff(st.staffId)}
                                className="px-2.5 py-1.5 border border-rose-500/20 hover:bg-rose-500/10 text-rose-500 rounded-lg inline-flex items-center gap-1 font-bold text-[10px] transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" /> Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.div>
            )}

            {/* SUBTAB 3: DEPARTMENTS MANAGEMENT */}
            {activeTab === 'depts' && (
              <motion.div
                key="depts"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-lg space-y-6"
              >
                <div>
                  <h2 className="text-lg font-bold tracking-tight">Academic Departments Management</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Configure structural academic departments or create fresh designations.</p>
                </div>

                {/* Add Dept Form */}
                <form onSubmit={handleAddDept} className="bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row gap-4 items-end">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Dept Code</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. cse"
                      value={newDeptId}
                      onChange={(e) => setNewDeptId(e.target.value)}
                      className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>

                  <div className="flex-[2]">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Department Title Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Computer Science Engineering"
                      value={newDeptName}
                      onChange={(e) => setNewDeptName(e.target.value)}
                      className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isAddingDept}
                    className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-semibold flex items-center gap-1.5 shadow-lg shadow-violet-600/20 text-xs cursor-pointer h-10 shrink-0"
                  >
                    <Plus className="w-4 h-4" /> Add Designation
                  </button>
                </form>

                {/* Dept list */}
                {departments.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                    No records found.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {departments.map((d) => (
                      <div key={d.id} className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-sm">
                        <div>
                          <span className="text-[10px] uppercase font-mono tracking-widest font-black text-violet-500 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/10">{d.id}</span>
                          <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100 mt-2">{d.name}</h4>
                        </div>

                        <button
                          onClick={() => handleDeleteDept(d.id)}
                          className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-xl transition-all cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* SUBTAB 4: SYSTEM SETTINGS */}
            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-lg space-y-6"
              >
                <div>
                  <h2 className="text-lg font-bold tracking-tight">Facial Attendance Parameters</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Configure active check-in thresholds and college operational schedules.</p>
                </div>

                <form onSubmit={handleSaveSettings} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Entry Window */}
                    <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 bg-slate-50/50 dark:bg-slate-950/20">
                      <h3 className="font-bold text-xs uppercase tracking-widest text-slate-400 font-mono">Entrance Scanning Window</h3>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Start Time (24h)</label>
                          <input
                            type="time"
                            required
                            value={entryStart}
                            onChange={(e) => setEntryStart(e.target.value)}
                            className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">End Time (24h)</label>
                          <input
                            type="time"
                            required
                            value={entryEnd}
                            onChange={(e) => setEntryEnd(e.target.value)}
                            className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Exit Window */}
                    <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 bg-slate-50/50 dark:bg-slate-950/20">
                      <h3 className="font-bold text-xs uppercase tracking-widest text-slate-400 font-mono">Exit Scanning Window</h3>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Start Time (24h)</label>
                          <input
                            type="time"
                            required
                            value={exitStart}
                            onChange={(e) => setExitStart(e.target.value)}
                            className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">End Time (24h)</label>
                          <input
                            type="time"
                            required
                            value={exitEnd}
                            onChange={(e) => setExitEnd(e.target.value)}
                            className="w-full text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 flex justify-end">
                    <button
                      type="submit"
                      disabled={isSavingSettings}
                      className="px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-2xl font-semibold flex items-center gap-1.5 shadow-lg shadow-violet-600/20 text-xs cursor-pointer"
                    >
                      {isSavingSettings ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <>
                          <Save className="w-4 h-4" /> Save Configuration
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </motion.div>
            )}

            {/* SUBTAB 5: SYSTEM CONFIGURATION BOOTSTRAPPER */}
            {activeTab === 'bootstrapper' && (
              <motion.div
                key="bootstrapper"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-lg space-y-4 text-center max-w-lg mx-auto"
              >
                <div className="p-4 bg-amber-500/10 text-amber-500 rounded-full border border-amber-500/20 w-16 h-16 flex items-center justify-center mx-auto mb-2">
                  <ShieldAlert className="w-8 h-8" />
                </div>
                
                <h2 className="text-xl font-bold tracking-tight">System Config Initializer</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Initialize system default settings and default academic departments in Firestore.
                </p>

                <div className="pt-4">
                  <button
                    onClick={handleBootstrapDatabase}
                    className="w-full py-3 px-4 bg-violet-600 hover:bg-violet-500 text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-violet-600/20 cursor-pointer"
                  >
                    <Play className="w-5 h-5 fill-white" />
                    Initialize System Configuration
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
