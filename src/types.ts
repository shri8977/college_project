export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: 'student' | 'staff' | 'admin';
  createdAt: string;
  faceResetRequested?: boolean;
}

export interface StudentProfile {
  studentId: string; // matches uid
  uid: string;
  studentName: string;
  rollNumber: string;
  department: string;
  year: string;
  assignedClass?: string;
  email: string;
  faceRegistered: boolean;
  faceEmbedding?: number[] | null; // Master average feature numbers
  faceEmbeddings?: Array<{ vector: number[] }> | number[][] | null; // Multi-angle individual descriptors
  photoURL?: string;
  attendancePercentage: number;
  faceResetRequested?: boolean;
  faceResetRequestedAt?: string;
}

export interface StaffProfile {
  staffId: string;
  uid: string;
  fullName: string;
  staffName?: string; // fallback
  department: string;
  assignedClass: string;
  email: string;
  role?: string;
  createdAt?: string;
}

export interface AttendanceRecord {
  attendanceId: string; // formatted like "uid_YYYY-MM-DD"
  studentId: string;
  date: string; // "YYYY-MM-DD"
  entryTime?: string; // "HH:MM:SS"
  exitTime?: string; // "HH:MM:SS"
  entryStatus: 'Present' | 'Absent' | 'Late' | 'Pending';
  exitStatus: 'Present' | 'Absent' | 'Early' | 'Pending';
  overallStatus: 'Present' | 'Half Day' | 'Absent' | 'Needs Staff Review';
  matchScore?: number;
  distanceValue?: number;
  verificationTimestamp?: string;
  attendanceMethod?: string;
  verificationResult?: string;
}

export interface Department {
  id: string;
  name: string;
}

export interface SystemSettings {
  id: string;
  entryStartTime: string; // "09:00"
  entryEndTime: string;   // "09:30"
  exitStartTime: string;  // "15:00"
  exitEndTime: string;    // "15:15"
}
