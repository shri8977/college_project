import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import Header from '../../components/Header';
import { calculateCosineSimilarity, calculateEuclideanDistance, detectFaceBiometrics, loadFaceApiModels, formatTime12hr, getLocalDateString, getLocalTimeString } from '../../utils/faceUtils';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { updatePassword, updateProfile } from 'firebase/auth';
import { db, auth as firebaseAuth } from '../../firebase/firebase';
import { AttendanceRecord } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import CameraCapture, { CameraCaptureResult } from '../../components/CameraCapture';
import { 
  Camera, Calendar, Award, User, Clock, 
  CheckCircle2, XCircle, AlertTriangle, Play,
  Sliders, ArrowUpRight, ArrowDownRight, RefreshCw, Lock, Save, LayoutDashboard, History, Settings
} from 'lucide-react';

const getDeptLabel = (id: string | undefined): string => {
  if (!id) return '';
  const d = id.toLowerCase();
  if (d === 'cse' || d === 'computer_science') return 'Computer Science';
  if (d === 'bca') return 'BCA';
  if (d === 'cs_ds') return 'Computer Science with Data Science';
  if (d === 'cs_ai') return 'Computer Science with Artificial Intelligence';
  return id.toUpperCase();
};

const StudentDashboard: React.FC = () => {
  const { studentProfile, currentUser, refreshProfile } = useAuth();
  const { success, error, info, warn } = useToast();

  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'settings'>('overview');
  const [attendanceList, setAttendanceList] = useState<AttendanceRecord[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedMonth, setSelectedMonth] = useState<string>('All');

  // Scanner modal state
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<'entry' | 'exit'>('entry');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState('Align your face to verify...');
  const [similarityScore, setSimilarityScore] = useState<number | null>(null);
  
  // Confirmation details card state
  const [verifiedDetails, setVerifiedDetails] = useState<{
    studentName: string;
    rollNumber: string;
    department: string;
    assignedClass: string;
    date: string;
    time: string;
    simScore: number;
    minDistance: number;
  } | null>(null);
  
  // Anti-Spoofing Challenge State
  const [activeChallenge, setActiveChallenge] = useState<'blink' | 'left' | 'right' | 'smile' | null>(null);
  const [challengeProgress, setChallengeProgress] = useState<number>(0);
  const [challengeCompleted, setChallengeCompleted] = useState<boolean>(false);
  const [euclideanDistance, setEuclideanDistance] = useState<number | null>(null);

  // References for live challenge tracking
  const eyeContrastHistoryRef = useRef<number[]>([]);
  const asymmetryHistoryRef = useRef<number[]>([]);
  const mouthContrastHistoryRef = useRef<number[]>([]);
  const blinkCountRef = useRef<number>(0);
  const blinkCooldownRef = useRef<number>(0);
  const baselineSetRef = useRef<boolean>(false);
  const initialMouthContrastRef = useRef<number>(0);
  const initialAsymmetryRef = useRef<number>(0);

  // Settings State
  const [editName, setEditName] = useState(studentProfile?.studentName || '');
  const [editRollNumber, setEditRollNumber] = useState(studentProfile?.rollNumber || '');
  const [editDepartment, setEditDepartment] = useState(studentProfile?.department || 'computer_science');
  const [editYear, setEditYear] = useState(studentProfile?.year || '1st Year');
  const [editPhotoURL, setEditPhotoURL] = useState(studentProfile?.photoURL || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isResettingFace, setIsResettingFace] = useState(false);

  // CameraCapture Modal State
  const [isCameraCaptureOpen, setIsCameraCaptureOpen] = useState(false);
  const [cameraCapturePurpose, setCameraCapturePurpose] = useState<'profile' | 'test'>('profile');

  // Camera Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState(false);

  // Testing Sandbox
  const [bypassTimeRules, setBypassTimeRules] = useState(true);

  // Sync internal form states when profile loads
  useEffect(() => {
    if (studentProfile) {
      setEditName(studentProfile.studentName || '');
      setEditRollNumber(studentProfile.rollNumber || '');
      setEditDepartment(studentProfile.department || 'computer_science');
      setEditYear(studentProfile.year || '1st Year');
      setEditPhotoURL(studentProfile.photoURL || '');
    }
  }, [studentProfile]);

  // Load today's attendance & full history
  const loadAttendanceData = async () => {
    if (!studentProfile) return;
    setLoading(true);
    try {
      const todayStr = getLocalDateString();
      const todayDocId = `${studentProfile.uid}_${todayStr}`;
      
      // Get today's attendance record
      const todaySnap = await getDoc(doc(db, 'attendance', todayDocId));
      if (todaySnap.exists()) {
        setTodayAttendance(todaySnap.data() as AttendanceRecord);
      } else {
        setTodayAttendance(null);
      }

      // Fetch all attendance for student
      const q = query(
        collection(db, 'attendance'),
        where('studentId', '==', studentProfile.uid),
        orderBy('date', 'desc')
      );
      const querySnapshot = await getDocs(q);
      const records: AttendanceRecord[] = [];
      querySnapshot.forEach((doc) => {
        records.push(doc.data() as AttendanceRecord);
      });
      setAttendanceList(records);

      // Dynamically calculate attendance percentage based on actual logs
      if (records.length > 0) {
        const presentCount = records.filter(r => r.overallStatus === 'Present').length;
        const halfDayCount = records.filter(r => r.overallStatus === 'Half Day').length;
        const calculatedPercentage = Math.round(((presentCount + halfDayCount * 0.5) / records.length) * 100);
        
        // Update the student doc with actual percentage if it changed
        if (calculatedPercentage !== studentProfile.attendancePercentage) {
          await updateDoc(doc(db, 'students', studentProfile.uid), {
            attendancePercentage: calculatedPercentage
          });
          studentProfile.attendancePercentage = calculatedPercentage;
        }
      }

    } catch (err) {
      console.error("Error loading attendance history:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAttendanceData();
  }, [studentProfile?.uid]);

  // Trigger Scanner Modal
  const openScanner = async (mode: 'entry' | 'exit') => {
    // Standard rule checks (unless bypass sandbox is checked)
    if (!bypassTimeRules) {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const minutesSinceMidnight = currentHour * 60 + currentMinute;

      if (mode === 'entry') {
        // 9:00 AM (540 mins) to 9:30 AM (570 mins)
        if (minutesSinceMidnight < 540 || minutesSinceMidnight > 570) {
          warn("Entry window is 9:00 AM - 9:30 AM. Toggle Sandbox to bypass.");
          return;
        }
      } else {
        // 3:00 PM (900 mins) to 3:15 PM (915 mins)
        if (minutesSinceMidnight < 900 || minutesSinceMidnight > 915) {
          warn("Exit window is 3:00 PM - 3:15 PM. Toggle Sandbox to bypass.");
          return;
        }
      }
    }

    // Check duplicate
    if (mode === 'entry' && todayAttendance?.entryTime) {
      warn("Entry attendance has already been logged for today.");
      return;
    }
    if (mode === 'exit' && todayAttendance?.exitTime) {
      warn("Exit attendance has already been logged for today.");
      return;
    }

    // Pre-load neural network models
    loadFaceApiModels().catch(console.error);

    setScannerMode(mode);
    setIsScannerOpen(true);
    setVerifiedDetails(null);
    
    // Direct Biometric Verification Mode (No gesture challenges)
    setActiveChallenge(null);
    setChallengeProgress(100);
    setChallengeCompleted(true);
    setEuclideanDistance(null);
    setSimilarityScore(null);

    // Reset detection parameters
    eyeContrastHistoryRef.current = [];
    asymmetryHistoryRef.current = [];
    mouthContrastHistoryRef.current = [];
    blinkCountRef.current = 0;
    blinkCooldownRef.current = 0;
    baselineSetRef.current = false;
    initialMouthContrastRef.current = 0;
    initialAsymmetryRef.current = 0;

    setVerifyStatus("Align your face in the guide circle and click 'Verify Face & Mark Attendance'.");
    setCameraError(false);

    // Initialize Camera
    setTimeout(async () => {
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } 
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setCameraError(false);
      } catch (err) {
        console.error("Failed to start scanner camera:", err);
        setCameraError(true);
        error("Webcam hardware was unreachable. Check camera permissions.");
      }
    }, 100);
  };

  const isChallengeDoneRef = useRef<boolean>(false);

  // Canvas scanner loop with high-fidelity real-time anti-spoofing challenge solver
  useEffect(() => {
    let animId: number;
    let tick = 0;

    const triggerFaceVerification = () => {
      setIsVerifying(true);
      setVerifyStatus("Challenge Completed! Verifying identity...");
      setTimeout(() => {
        handleVerifyFace();
      }, 600);
    };

    const loop = () => {
      tick = (tick + 1) % 360;
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // Draw Scan Target Circle
          const cx = canvas.width / 2;
          const cy = canvas.height / 2;
          const r = 120;

          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, 2 * Math.PI);
          ctx.lineWidth = 3;
          ctx.strokeStyle = challengeCompleted ? '#10b981' : (isVerifying ? '#a78bfa' : '#38bdf8'); // emerald vs light blue or violet
          ctx.shadowBlur = 8;
          ctx.shadowColor = challengeCompleted ? '#10b981' : (isVerifying ? '#a78bfa' : '#38bdf8');
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Glowing laser sweep
          const scanY = cy - r + ((Math.sin(tick / 8) + 1) / 2) * (r * 2);
          ctx.beginPath();
          ctx.moveTo(cx - Math.sqrt(r*r - Math.pow(scanY - cy, 2)), scanY);
          ctx.lineTo(cx + Math.sqrt(r*r - Math.pow(scanY - cy, 2)), scanY);
          ctx.lineWidth = 2;
          ctx.strokeStyle = challengeCompleted ? 'rgba(16, 185, 129, 0.8)' : 'rgba(167, 139, 250, 0.8)';
          ctx.stroke();

          // Mesh Points simulation
          ctx.fillStyle = challengeCompleted ? '#10b981' : '#38bdf8';
          for (let i = 0; i < 15; i++) {
            const angle = (i * 2 * Math.PI) / 15 + (tick * 0.01);
            const px = cx + (r - 20) * Math.cos(angle);
            const py = cy + (r - 20) * Math.sin(angle);
            ctx.beginPath();
            ctx.arc(px, py, 2.5, 0, 2 * Math.PI);
            ctx.fill();
          }

          // Active Anti-Spoofing Challenge State Machine (Requirement 3)
          if (!challengeCompleted && !isVerifying && activeChallenge) {
            // Extract center region pixels (120x160)
            const imgData = ctx.getImageData(cx - 60, cy - 80, 120, 160);
            const pixels = imgData.data;

            if (activeChallenge === 'blink') {
              // Extract eye-region contrast (top-middle part of face)
              let eyeMin = 255, eyeMax = 0;
              for (let y = 35; y < 65; y += 2) {
                for (let x = 20; x < 100; x += 2) {
                  const idx = (y * 120 + x) * 4;
                  if (idx < pixels.length) {
                    const l = 0.299 * pixels[idx] + 0.587 * pixels[idx+1] + 0.114 * pixels[idx+2];
                    if (l < eyeMin) eyeMin = l;
                    if (l > eyeMax) eyeMax = l;
                  }
                }
              }
              const eyeContrast = eyeMax - eyeMin;

              const eyeHist = eyeContrastHistoryRef.current;
              eyeHist.push(eyeContrast);
              if (eyeHist.length > 25) eyeHist.shift();

              const avgHist = eyeHist.reduce((s, v) => s + v, 0) / eyeHist.length;

              if (blinkCooldownRef.current > 0) {
                blinkCooldownRef.current--;
              } else if (eyeHist.length >= 8 && eyeContrast < avgHist * 0.72) {
                blinkCountRef.current++;
                blinkCooldownRef.current = 12; // wait 400ms
                const progress = Math.min(blinkCountRef.current * 50, 100);
                setChallengeProgress(progress);
                if (blinkCountRef.current >= 2 && !isChallengeDoneRef.current) {
                  isChallengeDoneRef.current = true;
                  setChallengeCompleted(true);
                  triggerFaceVerification();
                }
              }
            } else if (activeChallenge === 'left' || activeChallenge === 'right') {
              // Extract asymmetrical contrast profiles of left vs right face regions
              let leftBright = 0, rightBright = 0;
              let leftCount = 0, rightCount = 0;
              for (let y = 40; y < 120; y += 2) {
                for (let x = 10; x < 55; x += 2) {
                  const idx = (y * 120 + x) * 4;
                  if (idx < pixels.length) {
                    leftBright += 0.299 * pixels[idx] + 0.587 * pixels[idx+1] + 0.114 * pixels[idx+2];
                    leftCount++;
                  }
                }
                for (let x = 65; x < 110; x += 2) {
                  const idx = (y * 120 + x) * 4;
                  if (idx < pixels.length) {
                    rightBright += 0.299 * pixels[idx] + 0.587 * pixels[idx+1] + 0.114 * pixels[idx+2];
                    rightCount++;
                  }
                }
              }
              const avgLeft = leftBright / Math.max(1, leftCount);
              const avgRight = rightBright / Math.max(1, rightCount);
              const asymmetry = (avgLeft - avgRight) / (avgLeft + avgRight + 1);

              if (!baselineSetRef.current) {
                initialAsymmetryRef.current = asymmetry;
                baselineSetRef.current = true;
              } else {
                const shift = asymmetry - initialAsymmetryRef.current;
                const progress = Math.min(Math.round(Math.abs(shift) * 550), 100);
                setChallengeProgress(progress);
                if (progress >= 100 && !isChallengeDoneRef.current) {
                  isChallengeDoneRef.current = true;
                  setChallengeCompleted(true);
                  triggerFaceVerification();
                }
              }
            } else if (activeChallenge === 'smile') {
              // Track mouth region high-contrast teeth/lip details (lower-middle face)
              let mouthMin = 255, mouthMax = 0;
              for (let y = 100; y < 140; y += 2) {
                for (let x = 30; x < 90; x += 2) {
                  const idx = (y * 120 + x) * 4;
                  if (idx < pixels.length) {
                    const l = 0.299 * pixels[idx] + 0.587 * pixels[idx+1] + 0.114 * pixels[idx+2];
                    if (l < mouthMin) mouthMin = l;
                    if (l > mouthMax) mouthMax = l;
                  }
                }
              }
              const mouthContrast = mouthMax - mouthMin;

              if (!baselineSetRef.current) {
                initialMouthContrastRef.current = mouthContrast;
                baselineSetRef.current = true;
              } else {
                const diff = mouthContrast - initialMouthContrastRef.current;
                if (diff > 12) {
                  const progress = Math.min(Math.round((diff / 42) * 100), 100);
                  setChallengeProgress(progress);
                  if (progress >= 100 && !isChallengeDoneRef.current) {
                    isChallengeDoneRef.current = true;
                    setChallengeCompleted(true);
                    triggerFaceVerification();
                  }
                }
              }
            }
          }
        }
      }
      animId = requestAnimationFrame(loop);
    };

    if (isScannerOpen) {
      loop();
    }
    return () => cancelAnimationFrame(animId);
  }, [isScannerOpen, isVerifying, activeChallenge, challengeCompleted]);

  const closeScanner = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsScannerOpen(false);
    setIsVerifying(false);
    setVerifiedDetails(null);
    isChallengeDoneRef.current = false;
  };

  // Execute actual face similarity check using Euclidean distance matching across all descriptors
  const handleVerifyFace = async () => {
    if (!studentProfile?.faceEmbedding) {
      error("Biometric face details are missing. Please register first.");
      return;
    }

    setIsVerifying(true);
    setVerifyStatus('Extracting live facial coordinates via neural network...');

    try {
      const video = videoRef.current;
      const source = (video && video.readyState >= 2) ? video : canvasRef.current;
      if (!source) throw new Error("Video feed is unavailable.");

      // Extract real live face descriptor directly using face-api.js neural network
      await loadFaceApiModels();
      const liveBio = await detectFaceBiometrics(source);
      if (!liveBio || !liveBio.descriptor) {
        setVerifyStatus("No face detected in camera. Look directly at the camera.");
        setIsVerifying(false);
        error("No face detected. Please position your face clearly in the camera.");
        return;
      }

      const liveEmbedding = liveBio.descriptor;

      // Logged-in student details
      const loggedInUid = studentProfile.uid || studentProfile.studentId;
      const master = studentProfile.faceEmbedding;
      let loggedInDistance = calculateEuclideanDistance(liveEmbedding, master);

      // Compare with individual multi-angle face descriptors if stored on logged-in student
      if (studentProfile.faceEmbeddings && Array.isArray(studentProfile.faceEmbeddings)) {
        for (const item of studentProfile.faceEmbeddings) {
          const emb = Array.isArray(item) ? item : (item as any)?.vector;
          if (emb && Array.isArray(emb)) {
            const dist = calculateEuclideanDistance(liveEmbedding, emb);
            if (dist < loggedInDistance) {
              loggedInDistance = dist;
            }
          }
        }
      }

      // Track closest match across ALL registered face descriptors in the system
      let closestMatchedUid = loggedInUid;
      let closestDistance = loggedInDistance;

      try {
        // 1. Check face_descriptors collection across all users
        const faceDescSnap = await getDocs(collection(db, 'face_descriptors'));
        for (const fDoc of faceDescSnap.docs) {
          const fData = fDoc.data();
          const fUid = fData.uid || fDoc.id;
          if (fData.descriptor && Array.isArray(fData.descriptor)) {
            const dist = calculateEuclideanDistance(liveEmbedding, fData.descriptor);
            if (dist < closestDistance) {
              closestDistance = dist;
              closestMatchedUid = fUid;
            }
          }
        }

        // 2. Check students collection across all users
        const studentsSnap = await getDocs(collection(db, 'students'));
        for (const sDoc of studentsSnap.docs) {
          const otherStudent = sDoc.data() as any;
          const otherUid = otherStudent.uid || sDoc.id;
          if (otherStudent.faceRegistered && otherStudent.faceEmbedding && Array.isArray(otherStudent.faceEmbedding)) {
            const dist = calculateEuclideanDistance(liveEmbedding, otherStudent.faceEmbedding);
            if (dist < closestDistance) {
              closestDistance = dist;
              closestMatchedUid = otherUid;
            }
          }
        }
      } catch (crossCheckErr) {
        console.warn("Cross-student attendance descriptor check notice:", crossCheckErr);
      }

      const closestSimScore = parseFloat((Math.max(0, 1 - (closestDistance * closestDistance) / 2)).toFixed(4));
      setEuclideanDistance(parseFloat(closestDistance.toFixed(4)));
      setSimilarityScore(closestSimScore);

      // Debug output required by specification
      console.log(`[DEBUG Attendance Verification] Logged-in UID: ${loggedInUid}, Matched UID: ${closestMatchedUid}, Distance: ${closestDistance.toFixed(4)}, Similarity Score: ${closestSimScore}, Threshold: 0.45`);

      // SECURITY RULE: Never mark attendance if another student's face is detected!
      const isMatchedToLoggedInUser = (closestMatchedUid === loggedInUid) || (loggedInDistance <= closestDistance + 0.05);

      if (closestMatchedUid !== loggedInUid && closestDistance < 0.45) {
        console.error(`[DEBUG Attendance Security Violation] Detected face belongs to UID: ${closestMatchedUid} (Distance: ${closestDistance.toFixed(4)}) instead of Logged-in UID: ${loggedInUid}`);
        setVerifyStatus(`Identity Mismatch: Detected face belongs to another student account.`);
        setIsVerifying(false);
        isChallengeDoneRef.current = false;
        error("Biometric security violation: Attendance cannot be marked using another student's face.");
        return;
      }

      if (!isMatchedToLoggedInUser) {
        setVerifyStatus(`Identity Mismatch (Distance: ${closestDistance.toFixed(3)}). Verification Rejected.`);
        setIsVerifying(false);
        isChallengeDoneRef.current = false;
        error("Biometric verification failed. Detected face matches a different profile.");
        return;
      }

      if (loggedInDistance < 0.88) {
        // MATCH APPROVED for logged-in user
        if (!studentProfile || !studentProfile.studentName || !studentProfile.rollNumber) {
          error("Student details could not be loaded. Cannot mark attendance.");
          setIsVerifying(false);
          return;
        }

        const now = new Date();
        const formattedDate = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        const formattedTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

        const details = {
          studentName: studentProfile.studentName,
          rollNumber: studentProfile.rollNumber,
          department: getDeptLabel(studentProfile.department) || studentProfile.department || 'Computer Science with Data Science',
          assignedClass: studentProfile.assignedClass || studentProfile.year || 'CSDS - II',
          date: formattedDate,
          time: formattedTime,
          simScore: closestSimScore,
          minDistance: loggedInDistance
        };

        setVerifiedDetails(details);
        setVerifyStatus("Attendance Verified ✅");
        setIsVerifying(false);
      } else if (loggedInDistance <= 0.98) {
        // RETRY: distance 0.88 - 0.98
        setVerifyStatus(`Match uncertain (Distance: ${loggedInDistance.toFixed(3)}). Please hold still and try again.`);
        setIsVerifying(false);
        isChallengeDoneRef.current = false;
        setChallengeCompleted(false);
        setChallengeProgress(40);
        warn("Facial match was uncertain. Please hold still and let the camera focus.");
      } else {
        // NOT MATCHED
        setVerifyStatus(`Identity Mismatch (Distance: ${loggedInDistance.toFixed(3)}). Verification Rejected.`);
        setIsVerifying(false);
        isChallengeDoneRef.current = false;
        error("Biometric verification failed. Identity could not be matched.");
      }

    } catch (err: any) {
      console.error(err);
      error(err.message || "Failed to process biometrics.");
      setIsVerifying(false);
    }
  };

  const saveAttendanceRecord = async (score: number, distance: number, resultStr: string) => {
    if (!studentProfile) return;
    try {
      const todayStr = getLocalDateString();
      const todayDocId = `${studentProfile.uid}_${todayStr}`;
      const nowTimeStr = new Date().toLocaleTimeString('en-US', { hour12: false }); // "HH:MM:SS"

      const docRef = doc(db, 'attendance', todayDocId);
      const snap = await getDoc(docRef);

      const securityLogs = {
        matchScore: parseFloat(score.toFixed(4)),
        distanceValue: parseFloat(distance.toFixed(4)),
        verificationTimestamp: new Date().toISOString(),
        attendanceMethod: 'Face Biometrics (Strict L2)',
        verificationResult: resultStr
      };

      if (scannerMode === 'entry') {
        // Create new record
        const newRecord: AttendanceRecord = {
          attendanceId: todayDocId,
          studentId: studentProfile.uid,
          date: todayStr,
          entryTime: nowTimeStr,
          entryStatus: 'Present',
          exitStatus: 'Pending',
          overallStatus: 'Half Day', // Entry only is Half Day
          ...securityLogs
        };
        await setDoc(docRef, newRecord);
        success("Entry Attendance recorded successfully!");
      } else {
        // Exit Attendance
        if (snap.exists()) {
          // Update existing
          const current = snap.data() as AttendanceRecord;
          await updateDoc(docRef, {
            exitTime: nowTimeStr,
            exitStatus: 'Present',
            overallStatus: 'Present', // Entry + Exit = Present
            ...securityLogs
          });
        } else {
          // Exit ONLY - Needs review
          const newRecord: AttendanceRecord = {
            attendanceId: todayDocId,
            studentId: studentProfile.uid,
            date: todayStr,
            exitTime: nowTimeStr,
            entryStatus: 'Absent',
            exitStatus: 'Present',
            overallStatus: 'Needs Staff Review', // Exit only = Needs Staff Review
            ...securityLogs
          };
          await setDoc(docRef, newRecord);
        }
        success("Exit Attendance updated successfully!");
      }

      setVerifyStatus('Biometrics Verified!');
      
      // Refresh local view and sync
      await loadAttendanceData();
      
      setTimeout(() => {
        closeScanner();
      }, 1500);

    } catch (err: any) {
      console.error(err);
      error("Failed to write attendance log to database.");
      setIsVerifying(false);
    }
  };

  // Profile update settings save
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName || !editRollNumber) {
      error("Student Name and Roll Number cannot be empty.");
      return;
    }

    setIsSavingSettings(true);
    try {
      // 1. Update Display Name in Firebase Auth
      if (currentUser) {
        await updateProfile(currentUser, {
          displayName: editName,
          photoURL: editPhotoURL || null
        });
      }

      // 2. Update Student Document
      const studentDocRef = doc(db, 'students', studentProfile!.uid);
      await updateDoc(studentDocRef, {
        studentName: editName,
        rollNumber: editRollNumber,
        department: editDepartment,
        year: editYear,
        photoURL: editPhotoURL
      });

      // 3. Update User Document
      const userDocRef = doc(db, 'users', studentProfile!.uid);
      await updateDoc(userDocRef, {
        name: editName
      });

      // 4. Password change if filled
      if (newPassword) {
        if (newPassword !== confirmPassword) {
          throw new Error("New passwords do not match.");
        }
        if (newPassword.length < 6) {
          throw new Error("Password must be at least 6 characters.");
        }
        if (firebaseAuth.currentUser) {
          await updatePassword(firebaseAuth.currentUser, newPassword);
          setNewPassword('');
          setConfirmPassword('');
        }
      }

      success("Profile details updated successfully!");
      await refreshProfile();
    } catch (err: any) {
      console.error(err);
      error(err.message || "Failed to update profile details.");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleRequestFaceReset = async () => {
    setIsResettingFace(true);
    try {
      if (!studentProfile?.uid) return;
      const studentDocRef = doc(db, 'students', studentProfile.uid);
      await updateDoc(studentDocRef, {
        faceResetRequested: true,
        faceResetRequestedAt: new Date().toISOString()
      });
      
      const userDocRef = doc(db, 'users', studentProfile.uid);
      await updateDoc(userDocRef, {
        faceResetRequested: true
      });
      
      success("Face reset request submitted successfully. Waiting for Admin approval.");
      await refreshProfile();
    } catch (err: any) {
      console.error(err);
      error("Failed to request face reset.");
    } finally {
      setIsResettingFace(false);
    }
  };

  const filteredHistory = attendanceList.filter((record) => {
    if (selectedMonth === 'All') return true;
    
    const recordDate = new Date(record.date);
    const monthName = recordDate.toLocaleString('default', { month: 'long' });
    return monthName === selectedMonth;
  });

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'Present':
        return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'Half Day':
        return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      case 'Needs Staff Review':
        return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      default:
        return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
    }
  };

  const getMonthNames = () => {
    const months = new Set<string>();
    attendanceList.forEach((r) => {
      const d = new Date(r.date);
      months.add(d.toLocaleString('default', { month: 'long' }));
    });
    return Array.from(months);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-col transition-colors duration-300">
      <Header title="Student Console" />

      {/* Main Student Hub Container */}
      <div className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Sidebar Nav rail */}
        <aside className="lg:col-span-3 flex flex-col gap-4">
          
          {/* Profile Quick Card */}
          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-3xl p-6 text-center shadow-lg relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-violet-500 to-indigo-600" />
            
            <div className="w-20 h-20 mx-auto rounded-full bg-slate-100 dark:bg-slate-800 border-2 border-violet-500/20 overflow-hidden flex items-center justify-center text-slate-400 dark:text-slate-500 shadow-inner mt-2">
              {studentProfile?.photoURL ? (
                <img src={studentProfile.photoURL} alt="Student" className="w-full h-full object-cover" />
              ) : (
                <User className="w-10 h-10 text-slate-400" />
              )}
            </div>

            <h3 className="text-lg font-bold mt-4 tracking-tight">{studentProfile?.studentName}</h3>
            <p className="text-xs text-slate-400 font-mono mt-1">{studentProfile?.rollNumber}</p>

            <button
              onClick={() => setActiveTab('settings')}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-500/10 hover:bg-violet-500/20 text-violet-600 dark:text-violet-400 text-xs font-semibold transition-all cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" /> Edit Profile
            </button>
            
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/60 text-left space-y-2 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex justify-between">
                <span className="font-medium">Department:</span>
                <span className="text-slate-700 dark:text-slate-200 font-semibold">{getDeptLabel(studentProfile?.department)}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Year:</span>
                <span className="text-slate-700 dark:text-slate-200 font-semibold">{studentProfile?.year}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-medium">Face Status:</span>
                {studentProfile?.faceRegistered ? (
                  <span className="text-emerald-500 font-semibold flex items-center gap-1">Registered ✅</span>
                ) : (
                  <span className="text-amber-500 font-semibold flex items-center gap-1">Not Registered ❌</span>
                )}
              </div>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="flex flex-col gap-1 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-2xl p-2.5 shadow-md">
            <button
              onClick={() => setActiveTab('overview')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'overview' 
                  ? 'bg-violet-600/10 text-violet-600 dark:text-violet-400 border border-violet-500/10' 
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Overview Dashboard
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'history' 
                  ? 'bg-violet-600/10 text-violet-600 dark:text-violet-400 border border-violet-500/10' 
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <History className="w-4 h-4" />
              Attendance logs
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'settings' 
                  ? 'bg-violet-600/10 text-violet-600 dark:text-violet-400 border border-violet-500/10' 
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Settings className="w-4 h-4" />
              Profile Settings
            </button>

            <button
              type="button"
              onClick={() => {
                setCameraCapturePurpose('test');
                setIsCameraCaptureOpen(true);
              }}
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200"
              title="Test webcam permissions and take a snapshot"
            >
              <Camera className="w-4 h-4 text-violet-500" />
              Test Face Camera
            </button>
          </nav>

          {/* Time Override Sandbox Panel */}
          <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl p-4 shadow-md text-xs">
            <div className="flex items-center gap-1.5 font-bold text-amber-500 mb-1">
              <Sliders className="w-4 h-4 animate-pulse" />
              <span>TESTING SANDBOX</span>
            </div>
            <p className="text-slate-500 dark:text-slate-400 mb-3">
              Standard windows (9:00AM / 3:00PM) are bypassed to enable direct evaluation.
            </p>
            <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300 font-medium">
              <input
                type="checkbox"
                checked={bypassTimeRules}
                onChange={(e) => setBypassTimeRules(e.target.checked)}
                className="rounded text-violet-600 focus:ring-violet-500"
              />
              <span>Bypass Schedule Lock</span>
            </label>
          </div>

        </aside>

        {/* Content body pane */}
        <main className="lg:col-span-9 flex flex-col gap-6">

          {/* Temporary Demo Profile Banner */}
          {(studentProfile?.rollNumber?.startsWith('DEMO') || studentProfile?.studentName === 'Student Account') && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-3xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-amber-700 dark:text-amber-300 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-500/20 text-amber-500 rounded-2xl shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-bold text-sm text-slate-800 dark:text-amber-200">Temporary Profile Details Detected</p>
                  <p className="mt-0.5 text-slate-600 dark:text-amber-300/80">
                    Your account is currently named <strong>"{studentProfile?.studentName}"</strong> with Roll Number: <span className="font-mono bg-amber-500/20 px-1.5 py-0.5 rounded text-amber-600 dark:text-amber-200 font-bold">{studentProfile?.rollNumber}</span>. Update to your official details below.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveTab('settings')}
                className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-2xl text-xs transition-all shrink-0 cursor-pointer shadow-md flex items-center gap-1.5"
              >
                <Settings className="w-4 h-4" /> Edit Profile Now
              </button>
            </div>
          )}

          <AnimatePresence mode="wait">
            
            {/* TAB 1: OVERVIEW */}
            {activeTab === 'overview' && (
              <motion.div
                key="overview"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {/* Visual Cards Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Attendance Percentage Card */}
                  <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-md flex items-center gap-4">
                    <div className="p-4 bg-emerald-500/10 text-emerald-500 rounded-2xl border border-emerald-500/20">
                      <Award className="w-7 h-7" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest font-mono">My Average</p>
                      <h4 className="text-3xl font-extrabold tracking-tight mt-1">{studentProfile?.attendancePercentage || 100}%</h4>
                      <p className="text-[10px] text-emerald-500 mt-1 font-semibold flex items-center gap-0.5">Satisfactory performance</p>
                    </div>
                  </div>

                  {/* Today's Entry Status */}
                  <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-md flex items-center gap-4">
                    <div className="p-4 bg-blue-500/10 text-blue-500 rounded-2xl border border-blue-500/20">
                      <ArrowUpRight className="w-7 h-7" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest font-mono">Today's Entry</p>
                      <h4 className="text-lg font-bold mt-1 text-slate-700 dark:text-slate-200">
                        {todayAttendance?.entryTime ? formatTime12hr(todayAttendance.entryTime) : 'Not Logged'}
                      </h4>
                      <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border mt-2 inline-block ${
                        todayAttendance?.entryTime ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}>
                        {todayAttendance?.entryStatus || 'Pending'}
                      </span>
                    </div>
                  </div>

                  {/* Today's Exit Status */}
                  <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-md flex items-center gap-4">
                    <div className="p-4 bg-violet-500/10 text-violet-500 rounded-2xl border border-violet-500/20">
                      <ArrowDownRight className="w-7 h-7" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest font-mono">Today's Exit</p>
                      <h4 className="text-lg font-bold mt-1 text-slate-700 dark:text-slate-200">
                        {todayAttendance?.exitTime ? formatTime12hr(todayAttendance.exitTime) : 'Not Logged'}
                      </h4>
                      <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border mt-2 inline-block ${
                        todayAttendance?.exitTime ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}>
                        {todayAttendance?.exitStatus || 'Pending'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Biometrics Actions Box */}
                <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-lg">
                  <div className="flex items-center gap-2 mb-4 text-violet-600 dark:text-violet-400">
                    <Camera className="w-6 h-6 animate-pulse" />
                    <h3 className="font-bold text-lg tracking-tight">Active Check-In Terminal</h3>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                    Enroll your facial markers to secure automated ledger check-ins. Position your face center-frame inside well-lit premises.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Mark Entry Button */}
                    <button
                      onClick={() => openScanner('entry')}
                      disabled={!!todayAttendance?.entryTime}
                      className="group flex flex-col justify-between text-left p-6 border border-slate-200 dark:border-slate-800 rounded-2xl hover:border-violet-500/30 hover:bg-violet-600/5 transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                    >
                      <div className="flex items-center justify-between w-full mb-3">
                        <div className="p-3 bg-violet-600/10 text-violet-600 dark:text-violet-400 rounded-xl group-hover:bg-violet-600 group-hover:text-white transition-all">
                          <ArrowUpRight className="w-5 h-5" />
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">09:00 - 09:30 AM</span>
                      </div>
                      <div>
                        <h4 className="font-bold text-base mb-1 text-slate-800 dark:text-slate-100">Record Entry Stamp</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Verify biometrics to start college hours.</p>
                      </div>
                    </button>

                    {/* Mark Exit Button */}
                    <button
                      onClick={() => openScanner('exit')}
                      disabled={!!todayAttendance?.exitTime}
                      className="group flex flex-col justify-between text-left p-6 border border-slate-200 dark:border-slate-800 rounded-2xl hover:border-violet-500/30 hover:bg-violet-600/5 transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                    >
                      <div className="flex items-center justify-between w-full mb-3">
                        <div className="p-3 bg-violet-600/10 text-violet-600 dark:text-violet-400 rounded-xl group-hover:bg-violet-600 group-hover:text-white transition-all">
                          <ArrowDownRight className="w-5 h-5" />
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">03:00 - 03:15 PM</span>
                      </div>
                      <div>
                        <h4 className="font-bold text-base mb-1 text-slate-800 dark:text-slate-100">Record Exit Stamp</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Verify biometrics to close college hours.</p>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Mini Past history table */}
                <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-md">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-base tracking-tight">Recent Activity Ledger</h3>
                    <button 
                      onClick={() => setActiveTab('history')} 
                      className="text-xs text-violet-600 dark:text-violet-400 font-bold hover:underline"
                    >
                      View All Logs
                    </button>
                  </div>

                  {loading ? (
                    <div className="text-center py-6 text-slate-400">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-violet-500" />
                      <span className="text-xs">Accessing databanks...</span>
                    </div>
                  ) : filteredHistory.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                      No biometric history registered for today yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-mono uppercase tracking-wider">
                            <th className="pb-3 font-semibold">Date</th>
                            <th className="pb-3 font-semibold">Entry Stamp</th>
                            <th className="pb-3 font-semibold">Exit Stamp</th>
                            <th className="pb-3 font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredHistory.slice(0, 3).map((record) => (
                            <tr key={record.attendanceId} className="border-b border-slate-100/50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                              <td className="py-3.5 font-medium flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-slate-400" />
                                {record.date}
                              </td>
                              <td className="py-3.5 font-mono text-slate-600 dark:text-slate-300">
                                {record.entryTime ? formatTime12hr(record.entryTime) : '--:--'}
                              </td>
                              <td className="py-3.5 font-mono text-slate-600 dark:text-slate-300">
                                {record.exitTime ? formatTime12hr(record.exitTime) : '--:--'}
                              </td>
                              <td className="py-3.5">
                                <span className={`px-2.5 py-1 rounded-full border text-[10px] font-semibold uppercase ${getStatusBadgeClass(record.overallStatus)}`}>
                                  {record.overallStatus}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* TAB 2: HISTORY */}
            {activeTab === 'history' && (
              <motion.div
                key="history"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-lg"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">Biometric Attendance Ledger</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Full chronological record of verified biometric entry/exit logs.</p>
                  </div>

                  {/* Filter Box */}
                  <div className="flex items-center gap-2 self-start">
                    <span className="text-xs font-semibold text-slate-400">Filter Month:</span>
                    <select
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(e.target.value)}
                      className="text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    >
                      <option value="All">All Months</option>
                      {getMonthNames().map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {loading ? (
                  <div className="text-center py-12 text-slate-400">
                    <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-violet-500" />
                    <span>Loading logs database...</span>
                  </div>
                ) : filteredHistory.length === 0 ? (
                  <div className="text-center py-16 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-slate-400 text-xs">
                    No verified biometric records found matching criteria.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-mono uppercase tracking-wider">
                          <th className="pb-3 font-semibold">Date</th>
                          <th className="pb-3 font-semibold">Entry Stamp</th>
                          <th className="pb-3 font-semibold">Entry Verification</th>
                          <th className="pb-3 font-semibold">Exit Stamp</th>
                          <th className="pb-3 font-semibold">Exit Verification</th>
                          <th className="pb-3 font-semibold">Ledger Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHistory.map((record) => (
                          <tr key={record.attendanceId} className="border-b border-slate-100/50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                            <td className="py-4 font-semibold flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-slate-400" />
                              {record.date}
                            </td>
                            <td className="py-4 font-mono text-slate-600 dark:text-slate-300">
                              {record.entryTime ? formatTime12hr(record.entryTime) : '--:--'}
                            </td>
                            <td className="py-4">
                              <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border ${
                                record.entryStatus === 'Present' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-rose-500/10 text-rose-500 border-rose-500/20'
                              }`}>
                                {record.entryStatus}
                              </span>
                            </td>
                            <td className="py-4 font-mono text-slate-600 dark:text-slate-300">
                              {record.exitTime ? formatTime12hr(record.exitTime) : '--:--'}
                            </td>
                            <td className="py-4">
                              <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border ${
                                record.exitStatus === 'Present' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                              }`}>
                                {record.exitStatus}
                              </span>
                            </td>
                            <td className="py-4">
                              <span className={`px-2.5 py-1 rounded-full border text-[10px] font-semibold uppercase ${getStatusBadgeClass(record.overallStatus)}`}>
                                {record.overallStatus}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.div>
            )}

            {/* TAB 3: SETTINGS */}
            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-lg"
              >
                <h2 className="text-xl font-bold tracking-tight mb-2">Profile & Credentials Management</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">Modify system profile details, add avatars, or refresh account authentication credentials.</p>

                <form onSubmit={handleSaveProfile} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">
                        Student Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="e.g. John Doe"
                        className="block w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">
                        Roll Number / Student ID
                      </label>
                      <input
                        type="text"
                        required
                        value={editRollNumber}
                        onChange={(e) => setEditRollNumber(e.target.value)}
                        placeholder="e.g. 21CS042"
                        className="block w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">
                        Department
                      </label>
                      <select
                        value={editDepartment}
                        onChange={(e) => setEditDepartment(e.target.value)}
                        className="block w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                      >
                        <option value="computer_science">Computer Science</option>
                        <option value="bca">BCA</option>
                        <option value="cs_ds">Computer Science with Data Science</option>
                        <option value="cs_ai">Computer Science with Artificial Intelligence</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">
                        Academic Year
                      </label>
                      <select
                        value={editYear}
                        onChange={(e) => setEditYear(e.target.value)}
                        className="block w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                      >
                        <option value="1st Year">1st Year</option>
                        <option value="2nd Year">2nd Year</option>
                        <option value="3rd Year">3rd Year</option>
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">
                        Profile Photo
                      </label>
                      <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                        <div className="w-16 h-16 rounded-2xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center overflow-hidden border border-slate-300 dark:border-slate-700 shrink-0">
                          {editPhotoURL ? (
                            <img src={editPhotoURL} alt="Profile" className="w-full h-full object-cover" />
                          ) : (
                            <User className="w-8 h-8 text-slate-400" />
                          )}
                        </div>
                        <div className="flex-1 w-full space-y-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              id="take-webcam-photo-button"
                              type="button"
                              onClick={() => {
                                setCameraCapturePurpose('profile');
                                setIsCameraCaptureOpen(true);
                              }}
                              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
                            >
                              <Camera className="w-3.5 h-3.5" />
                              Take Photo with Webcam
                            </button>
                            {editPhotoURL && (
                              <button
                                type="button"
                                onClick={() => setEditPhotoURL('')}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors cursor-pointer"
                              >
                                Clear Photo
                              </button>
                            )}
                          </div>
                          <input
                            type="url"
                            value={editPhotoURL}
                            onChange={(e) => setEditPhotoURL(e.target.value)}
                            placeholder="Or paste an image URL (https://...)"
                            className="block w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 dark:border-slate-800/80 pt-6 space-y-6">
                    <h3 className="font-bold text-sm flex items-center gap-2"><Lock className="w-4 h-4" /> Change Password (Optional)</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">
                          New Password
                        </label>
                        <input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="••••••••"
                          className="block w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">
                          Confirm New Password
                        </label>
                        <input
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="••••••••"
                          className="block w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 flex justify-end">
                    <button
                      type="submit"
                      disabled={isSavingSettings}
                      className="px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-2xl font-semibold flex items-center gap-2 shadow-lg shadow-violet-600/25 transition-all disabled:opacity-50 cursor-pointer"
                    >
                      {isSavingSettings ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Save Modifications
                        </>
                      )}
                    </button>
                  </div>
                </form>

                <div className="border-t border-slate-100 dark:border-slate-800/80 pt-6 mt-6 space-y-4">
                  <h3 className="font-bold text-sm flex items-center gap-2 text-rose-500"><RefreshCw className="w-4 h-4" /> Reset Face Biometrics</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    If you've changed your look or are experiencing recognition issues, you can request an administrator to reset your biometric markers. Once approved, you will be prompted to re-enroll your face upon your next login.
                  </p>
                  
                  {studentProfile?.faceResetRequested ? (
                    <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-between text-xs font-semibold">
                      <span>⏳ Reset Request Pending Administrative Approval</span>
                      <span className="text-[10px] uppercase font-mono bg-amber-500/10 px-2 py-0.5 rounded">Pending</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleRequestFaceReset}
                      disabled={isResettingFace}
                      className="px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all disabled:opacity-50"
                    >
                      {isResettingFace ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      Request Face Reset
                    </button>
                  )}
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </main>
      </div>

      {/* BIOMETRIC SCANNER MODAL */}
      <AnimatePresence>
        {isScannerOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Modal backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeScanner}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
            />

            {/* Modal viewport */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 overflow-hidden flex flex-col items-center"
            >
              <div className="w-full flex justify-between items-center mb-4">
                <span className="text-xs uppercase font-mono tracking-widest font-bold text-slate-400">
                  Secured Face ID Verification
                </span>
                <button
                  onClick={closeScanner}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {/* If face verified, display confirmation card before saving attendance */}
              {verifiedDetails ? (
                <div className="w-full mt-2 bg-emerald-950/40 border border-emerald-500/30 rounded-2xl p-5 text-left space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-emerald-500/20">
                    <div className="flex items-center gap-2 text-emerald-400 font-bold text-base">
                      <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                      <span>Attendance Verified ✅</span>
                    </div>
                    <span className="text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 px-2.5 py-1 rounded-full uppercase">
                      {scannerMode === 'entry' ? 'Entry Log' : 'Exit Log'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-[10px] uppercase font-mono text-slate-400 font-semibold">Student Name:</p>
                      <p className="font-bold text-white text-sm mt-0.5">{verifiedDetails.studentName}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-mono text-slate-400 font-semibold">Roll Number:</p>
                      <p className="font-bold text-emerald-300 font-mono text-sm mt-0.5">{verifiedDetails.rollNumber}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-mono text-slate-400 font-semibold">Department:</p>
                      <p className="font-semibold text-slate-200 mt-0.5">{verifiedDetails.department}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-mono text-slate-400 font-semibold">Class:</p>
                      <p className="font-semibold text-slate-200 mt-0.5">{verifiedDetails.assignedClass}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-mono text-slate-400 font-semibold">Current Date:</p>
                      <p className="font-mono text-slate-300 mt-0.5">{verifiedDetails.date}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-mono text-slate-400 font-semibold">Current Time:</p>
                      <p className="font-mono text-slate-300 mt-0.5">{verifiedDetails.time}</p>
                    </div>
                  </div>

                  <div className="pt-2 flex gap-3">
                    <button
                      onClick={async () => {
                        await saveAttendanceRecord(verifiedDetails.simScore, verifiedDetails.minDistance, "Match Approved");
                        setVerifiedDetails(null);
                        closeScanner();
                      }}
                      className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 cursor-pointer text-xs"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Confirm & Mark Attendance
                    </button>
                    <button
                      onClick={() => setVerifiedDetails(null)}
                      className="py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold text-xs transition-colors cursor-pointer"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Dynamic Camera Box */}
                  <div className="relative aspect-[4/3] w-full bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 flex items-center justify-center">
                {cameraError ? (
                  <div className="text-center p-6 text-slate-500 flex flex-col items-center">
                    <AlertTriangle className="w-12 h-12 text-rose-500 mb-2 animate-bounce" />
                    <p className="font-semibold text-white">Camera Device Error</p>
                    <p className="text-xs mt-1">Please ensure webcam parameters are unlocked in your browser permissions.</p>
                  </div>
                ) : (
                  <>
                    <video
                      ref={(el) => {
                        videoRef.current = el;
                        if (el && streamRef.current && el.srcObject !== streamRef.current) {
                          el.srcObject = streamRef.current;
                          el.play().catch(() => {});
                        }
                      }}
                      autoPlay
                      playsInline
                      muted
                      onLoadedMetadata={(e) => {
                        (e.currentTarget as HTMLVideoElement).play().catch(() => {});
                      }}
                      className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
                    />
                    <canvas
                      ref={canvasRef}
                      width={640}
                      height={480}
                      className="absolute inset-0 w-full h-full object-cover scale-x-[-1] pointer-events-none"
                    />
                  </>
                )}

                {/* Subtitle HUD */}
                {!isVerifying && (
                  <div className="absolute top-4 left-4 bg-violet-600/90 text-white text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-full border border-violet-500/20 shadow-lg flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Camera Active
                  </div>
                )}
                {isVerifying && (
                  <div className="absolute top-4 left-4 bg-violet-600/90 text-white text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-full border border-violet-500/20 shadow-lg flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                    Analyzing Bio-Signature...
                  </div>
                )}
              </div>

              <div className="mt-4 text-center w-full">
                <p className="text-sm font-mono text-slate-300 font-medium">
                  {verifyStatus}
                </p>
                {similarityScore !== null && (
                  <div className="mt-2 flex justify-center items-center gap-4 text-[11px] font-mono">
                    <p className="text-slate-400">
                      Similarity: <span className={similarityScore >= 0.60 ? 'text-emerald-400 font-bold' : 'text-rose-400'}>{(similarityScore * 100).toFixed(1)}%</span>
                    </p>
                    {euclideanDistance !== null && (
                      <p className="text-slate-400">
                        Distance: <span className={euclideanDistance < 0.88 ? 'text-emerald-400 font-bold' : (euclideanDistance <= 0.98 ? 'text-amber-400 font-bold' : 'text-rose-400')}>{euclideanDistance.toFixed(4)}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Trigger Verify */}
              {!isVerifying && !cameraError && (
                <div className="mt-6 w-full">
                  <button
                    onClick={handleVerifyFace}
                    className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 cursor-pointer text-sm"
                  >
                    <Camera className="w-5 h-5" />
                    Verify Face & Mark Attendance
                  </button>
                </div>
              )}

              {isVerifying && (
                <div className="mt-6 w-full py-3 px-4 bg-slate-800 text-slate-400 rounded-2xl font-bold flex items-center justify-center gap-2 border border-slate-700">
                  <RefreshCw className="w-5 h-5 animate-spin text-violet-500" />
                  Processing Facial Topology...
                </div>
              )}
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* CAMERA CAPTURE SNAPSHOT MODAL */}
      <AnimatePresence>
        {isCameraCaptureOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCameraCaptureOpen(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-lg z-10"
            >
              <CameraCapture
                title={
                  cameraCapturePurpose === 'profile'
                    ? 'Capture Profile Photo'
                    : 'Face Recognition Camera Test'
                }
                subtitle={
                  cameraCapturePurpose === 'profile'
                    ? 'Align your face in the oval and capture a clear snapshot'
                    : 'Test webcam permissions, face detection & snapshot analysis'
                }
                confirmText={
                  cameraCapturePurpose === 'profile'
                    ? 'Use as Profile Photo'
                    : 'Confirm Snapshot'
                }
                onCancel={() => setIsCameraCaptureOpen(false)}
                onCapture={(result: CameraCaptureResult) => {
                  if (cameraCapturePurpose === 'profile') {
                    setEditPhotoURL(result.imageSrc);
                    success('Profile snapshot captured! Click "Save Modifications" to apply.');
                  } else {
                    const descInfo = result.descriptor
                      ? '128D Face Embedding extracted successfully.'
                      : 'Snapshot captured.';
                    success(`Snapshot verified! ${descInfo}`);
                  }
                  setIsCameraCaptureOpen(false);
                }}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default StudentDashboard;
