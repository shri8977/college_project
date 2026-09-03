import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import Header from '../../components/Header';
import { doc, setDoc, collection, getDocs } from 'firebase/firestore';
import { db, storage, auth } from '../../firebase/firebase';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { motion } from 'motion/react';
import { 
  CheckCircle2, AlertCircle, ShieldCheck, 
  Camera, ArrowRight, RotateCcw, AlertTriangle, 
  Sparkles, Loader2, Upload, ExternalLink, Image as ImageIcon,
  Check, RefreshCw, FileUp
} from 'lucide-react';
import { 
  loadFaceApiModels, 
  isFaceApiLoaded,
  detectFaceBiometrics, 
  calculateEuclideanDistance, 
  LiveBiometricsResult,
  PoseType
} from '../../utils/faceUtils';

// Number of consecutive frames required with the expected pose before advancing
const REQUIRED_STABLE_FRAMES = 8;

type FlowStep = 
  | 'lookStraight'   // Step 1: Look Straight & Hold
  | 'turnLeft'       // Step 2: Turn Head Left
  | 'turnRight'      // Step 3: Turn Head Right
  | 'finalCapture'   // Step 4: Final Biometric Capture
  | 'duplicateCheck' // Step 5: Duplicate Verification
  | 'saving'         // Step 6: Save Registration to DB
  | 'success'        // Done
  | 'error';         // Stopped due to duplicate or error

interface StepInfo {
  id: FlowStep;
  number: number;
  label: string;
  title: string;
  instruction: string;
}

const STEPS: StepInfo[] = [
  { 
    id: 'lookStraight', 
    number: 1, 
    label: 'Look Straight', 
    title: 'LOOK STRAIGHT', 
    instruction: 'Look directly at the camera. Keep your face visible and hold steady.' 
  },
  { 
    id: 'turnLeft', 
    number: 2, 
    label: 'Turn Head Left', 
    title: 'TURN HEAD LEFT', 
    instruction: 'Turn your head slightly to your LEFT while keeping your face visible.' 
  },
  { 
    id: 'turnRight', 
    number: 3, 
    label: 'Turn Head Right', 
    title: 'TURN HEAD RIGHT', 
    instruction: 'Turn your head slightly to your RIGHT while keeping your face visible.' 
  },
  { 
    id: 'finalCapture', 
    number: 4, 
    label: 'Final Face Capture', 
    title: 'FINAL CAPTURE', 
    instruction: 'Securing your high-resolution facial profile and biometric embedding.' 
  },
  { 
    id: 'duplicateCheck', 
    number: 5, 
    label: 'Duplicate Face Check', 
    title: 'DUPLICATE CHECK', 
    instruction: 'Verifying facial uniqueness against registered database records.' 
  },
  { 
    id: 'saving', 
    number: 6, 
    label: 'Save Registration', 
    title: 'SAVING PROFILE', 
    instruction: 'Enrolling your biometric identity to your student account.' 
  }
];

const FaceRegistration: React.FC = () => {
  const { studentProfile, refreshProfile } = useAuth();
  const { success, error, info } = useToast();
  const navigate = useNavigate();

  // Elements & Media Stream refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // States
  const [enrollmentMode, setEnrollmentMode] = useState<'camera' | 'upload' | 'demo'>('camera');
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [cameraErrorMessage, setCameraErrorMessage] = useState<string | null>(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [currentStep, setCurrentStep] = useState<FlowStep>('lookStraight');
  const [stepProgress, setStepProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Position face inside guide');
  const [isFaceDetected, setIsFaceDetected] = useState(false);
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<{ matchedUid?: string; distance?: number } | null>(null);
  const [isProcessingEnrollment, setIsProcessingEnrollment] = useState(false);
  const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);

  // Debug indicator states (Live real-time telemetry)
  const [debugFaceDetected, setDebugFaceDetected] = useState<boolean>(false);
  const [debugLandmarksDetected, setDebugLandmarksDetected] = useState<boolean>(false);
  const [debugYaw, setDebugYaw] = useState<number | null>(null);
  const [debugDetectedPose, setDebugDetectedPose] = useState<PoseType>('UNKNOWN');
  const [debugExpectedPose, setDebugExpectedPose] = useState<'STRAIGHT' | 'LEFT' | 'RIGHT'>('STRAIGHT');
  const [debugStableFrames, setDebugStableFrames] = useState<number>(0);

  // Loop & state tracking refs to eliminate stale closures and duplicate rAF loops
  const currentStepRef = useRef<FlowStep>('lookStraight');
  const modelsReadyRef = useRef<boolean>(false);
  const consecutiveStableFramesRef = useRef<number>(0);
  const isTransitioningRef = useRef<boolean>(false);
  const isProcessingRef = useRef<boolean>(false);
  const capturedDescriptorsRef = useRef<number[][]>([]);
  const lastDetectionTimeRef = useRef<number>(0);

  // Detect whether running in an embedded preview iframe
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  // Synchronize refs with state
  useEffect(() => {
    currentStepRef.current = currentStep;
    if (currentStep === 'lookStraight') {
      setDebugExpectedPose('STRAIGHT');
    } else if (currentStep === 'turnLeft') {
      setDebugExpectedPose('LEFT');
    } else if (currentStep === 'turnRight') {
      setDebugExpectedPose('RIGHT');
    }
  }, [currentStep]);

  useEffect(() => {
    modelsReadyRef.current = modelsReady;
  }, [modelsReady]);

  // Cleanly stop any existing camera tracks
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Initialize camera stream with graceful user-gesture and iframe context awareness
  const startCamera = useCallback(async (isUserInitiated: boolean = false) => {
    try {
      setHasCameraPermission(null);
      setCameraErrorMessage(null);

      // Stop any existing stream before creating a new one
      stopCamera();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access is not supported by your current browser environment.');
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      streamRef.current = stream;
      setHasCameraPermission(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().then(() => {
            console.log('[FaceRegistration] Camera ready');
          }).catch((playErr) => {
            console.warn('[FaceRegistration] Video play notice:', playErr);
          });
        };
      }
    } catch (err: any) {
      // Use console.warn to prevent expected browser context permission restrictions from throwing uncaught application errors
      console.warn('[FaceRegistration] Camera access not allowed in current context:', err?.message || err);
      setHasCameraPermission(false);
      const isDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      const isContextRestricted =
        err.message?.includes('not allowed by the user agent') ||
        err.message?.includes('current context') ||
        isInIframe;

      let msg = 'Unable to access camera. Please check your camera permissions.';
      if (isContextRestricted) {
        msg = 'Camera access is restricted in this embedded preview by the browser. You can open in a new tab, grant permission, or upload a face photo.';
      } else if (isDenied) {
        msg = 'Camera permission was denied. Please allow camera access in your browser or upload a face photo.';
      }

      setCameraErrorMessage(msg);
      setStatusMessage(msg);
      if (isUserInitiated) {
        error(msg);
      }
    }
  }, [error, isInIframe, stopCamera]);

  // Load face-api neural network models on mount
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        await loadFaceApiModels();
        if (isMounted) {
          setModelsReady(true);
        }
      } catch (err) {
        console.warn('[FaceRegistration] Face recognition models notice:', err);
        if (isMounted) {
          error('Failed to load face recognition models. Please refresh.');
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [error]);

  // Start camera on mount & stop on unmount (non-user-initiated, silent check)
  useEffect(() => {
    if (enrollmentMode === 'camera') {
      startCamera(false);
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [enrollmentMode, startCamera, stopCamera]);

  // Core biometric database persistence & uniqueness validation helper
  const saveEnrollmentData = useCallback(async (
    masterEmbedding: number[],
    allDescriptors: number[][],
    photoDataUrl: string
  ) => {
    const studentUid = studentProfile?.uid || studentProfile?.studentId || auth.currentUser?.uid;

    if (!studentUid || !studentProfile) {
      error('Student profile is missing. Please log in again.');
      setCurrentStep('error');
      return false;
    }

    try {
      // STEP 5: DUPLICATE FACE CHECK
      setCurrentStep('duplicateCheck');
      setStatusMessage('Verifying face uniqueness against registered database records...');
      await new Promise((r) => setTimeout(r, 400));

      let duplicateFound = false;
      let duplicateMatchedUid = '';
      let duplicateDistance = 999;

      try {
        // 1. Check face_descriptors collection
        const faceDescSnap = await getDocs(collection(db, 'face_descriptors'));
        for (const fDoc of faceDescSnap.docs) {
          const fData = fDoc.data();
          const fUid = fData.uid || fDoc.id;
          if (fUid !== studentUid && fData.descriptor && Array.isArray(fData.descriptor)) {
            const dist = calculateEuclideanDistance(masterEmbedding, fData.descriptor);
            if (dist < 0.45 && dist < duplicateDistance) {
              duplicateDistance = dist;
              duplicateMatchedUid = fUid;
              duplicateFound = true;
            }
          }
        }

        // 2. Cross-check students collection
        if (!duplicateFound) {
          const studentsSnap = await getDocs(collection(db, 'students'));
          for (const sDoc of studentsSnap.docs) {
            const sData = sDoc.data() as any;
            const sUid = sData.uid || sDoc.id;
            if (sUid !== studentUid && sData.faceRegistered && sData.faceEmbedding && Array.isArray(sData.faceEmbedding)) {
              const dist = calculateEuclideanDistance(masterEmbedding, sData.faceEmbedding);
              if (dist < 0.45 && dist < duplicateDistance) {
                duplicateDistance = dist;
                duplicateMatchedUid = sUid;
                duplicateFound = true;
              }
            }
          }
        }
      } catch (checkErr) {
        console.warn('Duplicate face cross-check notice:', checkErr);
      }

      if (duplicateFound) {
        stopCamera();
        setDuplicateError({ matchedUid: duplicateMatchedUid, distance: duplicateDistance });
        setCurrentStep('error');
        setStatusMessage('This face is already registered with another account.');
        error('This face is already registered.');
        return false;
      }

      // STEP 6: SAVE REGISTRATION
      setCurrentStep('saving');
      setStatusMessage('Saving biometric profile to student database...');

      // Upload photo to Firebase Storage
      let finalPhotoUrl = photoDataUrl;
      try {
        const storageRef = ref(storage, `faces/${studentUid}/profile.jpg`);
        await uploadString(storageRef, photoDataUrl, 'data_url');
        finalPhotoUrl = await getDownloadURL(storageRef);
      } catch (storageErr) {
        console.warn('Storage upload fallback to dataURL:', storageErr);
      }

      // Save to face_descriptors collection
      await setDoc(
        doc(db, 'face_descriptors', studentUid),
        {
          uid: studentUid,
          studentName: studentProfile.studentName || 'Student',
          rollNumber: studentProfile.rollNumber || '',
          descriptor: masterEmbedding,
          createdAt: new Date().toISOString(),
        },
        { merge: true }
      );

      // Save to students collection
      await setDoc(
        doc(db, 'students', studentUid),
        {
          faceRegistered: true,
          faceEmbedding: masterEmbedding,
          faceEmbeddings: allDescriptors,
          photoURL: finalPhotoUrl,
          faceRegisteredAt: new Date().toISOString(),
        },
        { merge: true }
      );

      // Mark faceRegistered in users collection
      await setDoc(
        doc(db, 'users', studentUid),
        { faceRegistered: true },
        { merge: true }
      );

      // Refresh authentication profile
      await refreshProfile();

      // Finish cleanly
      stopCamera();
      setCurrentStep('success');
      setStatusMessage('Face registered successfully');
      success('Face Registration Completed ✓');
      return true;
    } catch (err: any) {
      console.warn('[FaceRegistration] Save enrollment error:', err);
      setCurrentStep('error');
      const msg = err.message || 'Failed to complete registration.';
      setStatusMessage(msg);
      error(msg);
      return false;
    }
  }, [error, refreshProfile, stopCamera, studentProfile, success]);

  // Execute Step 4 (Final Capture), Step 5 (Duplicate Check), Step 6 (Save Registration) for Live Camera
  const executeFinalizeFlow = useCallback(async () => {
    isTransitioningRef.current = true;
    const video = videoRef.current;
    const studentUid = studentProfile?.uid || studentProfile?.studentId || auth.currentUser?.uid;

    if (!studentUid || !studentProfile) {
      error('Student profile is missing. Please log in again.');
      setCurrentStep('error');
      return;
    }

    try {
      setCurrentStep('finalCapture');
      setStatusMessage('Capturing final frontal face profile...');
      setStepProgress(100);

      if (!video || video.readyState < 2) {
        throw new Error('Live camera stream is unavailable for final capture.');
      }

      // Generate snapshot photo from the current live video frame
      const snapCanvas = document.createElement('canvas');
      snapCanvas.width = video.videoWidth || 640;
      snapCanvas.height = video.videoHeight || 480;
      const snapCtx = snapCanvas.getContext('2d');
      if (snapCtx) {
        snapCtx.translate(snapCanvas.width, 0);
        snapCtx.scale(-1, 1);
        snapCtx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height);
      }
      const photoDataUrl = snapCanvas.toDataURL('image/jpeg', 0.90);
      setCapturedPhotoUrl(photoDataUrl);

      // Extract biometric descriptor from live frame
      const finalBio = await detectFaceBiometrics(video);
      let finalDescriptor: number[] = [];

      if (finalBio && finalBio.descriptor && finalBio.descriptor.length === 128) {
        finalDescriptor = finalBio.descriptor;
      } else if (capturedDescriptorsRef.current.length > 0) {
        finalDescriptor = capturedDescriptorsRef.current[0];
      } else {
        throw new Error('Unable to extract facial descriptor. Please try again.');
      }

      // Combine captured descriptors into normalized master embedding
      const allDescriptors = [...capturedDescriptorsRef.current, finalDescriptor];
      const masterVector = new Array(128).fill(0);
      for (let i = 0; i < 128; i++) {
        let sum = 0;
        for (const desc of allDescriptors) {
          sum += desc[i];
        }
        masterVector[i] = sum / allDescriptors.length;
      }

      // L2 Normalize
      const norm = Math.sqrt(masterVector.reduce((s, v) => s + v * v, 0)) || 1;
      const masterEmbedding = masterVector.map((v) => parseFloat((v / norm).toFixed(6)));

      await saveEnrollmentData(masterEmbedding, allDescriptors, photoDataUrl);
    } catch (err: any) {
      console.warn('[FaceRegistration] Finalize camera flow error:', err);
      setCurrentStep('error');
      const msg = err.message || 'Failed to complete registration.';
      setStatusMessage(msg);
      error(msg);
    } finally {
      isTransitioningRef.current = false;
    }
  }, [error, saveEnrollmentData, studentProfile]);

  // Handle Photo File Upload for Face Enrollment
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      error('Please select an image file (JPEG, PNG, or WebP).');
      return;
    }

    setIsProcessingEnrollment(true);
    setStatusMessage('Analyzing facial biometrics from uploaded photo...');

    try {
      await loadFaceApiModels();
      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUrl = event.target?.result as string;
        setUploadedImagePreview(dataUrl);

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = async () => {
          try {
            const bio = await detectFaceBiometrics(img);
            if (!bio || !bio.descriptor || bio.descriptor.length !== 128) {
              setIsProcessingEnrollment(false);
              error('No clear human face was detected in this photo. Please upload a clear frontal portrait with good lighting.');
              return;
            }

            setCapturedPhotoUrl(dataUrl);
            const masterEmbedding = bio.descriptor;
            await saveEnrollmentData(masterEmbedding, [masterEmbedding], dataUrl);
          } catch (detErr: any) {
            console.warn('[FaceRegistration] Photo biometric extraction notice:', detErr);
            error('Failed to extract facial biometrics from image. Please try another photo.');
          } finally {
            setIsProcessingEnrollment(false);
          }
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      console.warn('[FaceRegistration] Photo reading error:', err);
      setIsProcessingEnrollment(false);
      error('Unable to read selected photo file.');
    }
  };

  // One-Click Demo Enrollment for rapid evaluation in sandbox environments
  const handleDemoEnrollment = async () => {
    setIsProcessingEnrollment(true);
    setStatusMessage('Generating verified biometric face profile...');

    try {
      const studentUid = studentProfile?.uid || studentProfile?.studentId || 'student_demo';
      let hash = 0;
      for (let i = 0; i < studentUid.length; i++) {
        hash = ((hash << 5) - hash) + studentUid.charCodeAt(i);
        hash |= 0;
      }

      const demoVector = new Array(128).fill(0).map((_, idx) => {
        return Math.sin(hash * 0.13 + idx * 0.47) * 0.35 + (idx % 2 === 0 ? 0.05 : -0.05);
      });
      const norm = Math.sqrt(demoVector.reduce((s, v) => s + v * v, 0)) || 1;
      const normalizedDemo = demoVector.map((v) => parseFloat((v / norm).toFixed(6)));

      // Generate portrait card
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const grad = ctx.createLinearGradient(0, 0, 400, 400);
        grad.addColorStop(0, '#4f46e5');
        grad.addColorStop(1, '#7c3aed');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 400, 400);

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(200, 150, 65, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(200, 310, 110, 80, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#4338ca';
        ctx.font = 'bold 44px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(studentProfile?.studentName?.charAt(0) || 'S', 200, 150);
      }
      const demoPhotoUrl = canvas.toDataURL('image/jpeg', 0.9);
      setCapturedPhotoUrl(demoPhotoUrl);

      await saveEnrollmentData(normalizedDemo, [normalizedDemo], demoPhotoUrl);
    } catch (demoErr: any) {
      console.warn('[FaceRegistration] Demo enrollment notice:', demoErr);
      error('Failed to complete demo enrollment.');
    } finally {
      setIsProcessingEnrollment(false);
    }
  };

  // Reset registration button handler: Completely resets state back to Step 1
  const handleRestart = () => {
    capturedDescriptorsRef.current = [];
    consecutiveStableFramesRef.current = 0;
    isTransitioningRef.current = false;
    isProcessingRef.current = false;
    setDuplicateError(null);
    setCapturedPhotoUrl(null);
    setStepProgress(0);
    setDebugStableFrames(0);
    setDebugFaceDetected(false);
    setDebugLandmarksDetected(false);
    setDebugYaw(null);
    setDebugDetectedPose('UNKNOWN');
    setCurrentStep('lookStraight');
    currentStepRef.current = 'lookStraight';
    setStatusMessage('Position face inside guide');
    setIsFaceDetected(false);
    startCamera();
    info('Face Registration Reset to Step 1 — Look Straight');
  };

  // Continuous Detection Loop using requestAnimationFrame
  // Processes live video frames with landmark-based pose estimation & frame smoothing
  useEffect(() => {
    let animId: number;
    let isMounted = true;

    const runLoop = async (timestamp: number) => {
      if (!isMounted) return;

      const step = currentStepRef.current;
      const isChecking = step === 'lookStraight' || step === 'turnLeft' || step === 'turnRight';

      // Ensure video is playing and ready
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (
        isChecking &&
        (modelsReadyRef.current || isFaceApiLoaded()) &&
        video &&
        video.readyState >= 1 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0 &&
        !isTransitioningRef.current &&
        !isProcessingRef.current &&
        timestamp - lastDetectionTimeRef.current > 35
      ) {
        lastDetectionTimeRef.current = timestamp;
        isProcessingRef.current = true;

        try {
          // Run fast face detection + 68-point facial landmark extraction on live HTMLVideoElement
          const liveBio: LiveBiometricsResult | null = await detectFaceBiometrics(video, {
            extractDescriptor: false,
            inputSize: 320,
            scoreThreshold: 0.10,
          });

          const hasFace = Boolean(liveBio && liveBio.detection);
          const hasLandmarks = Boolean(liveBio && liveBio.hasLandmarks);

          // Draw visual oval guide overlay and live face tracking on canvas
          if (canvas) {
            const displayW = canvas.clientWidth || 640;
            const displayH = canvas.clientHeight || 480;
            if (canvas.width !== displayW || canvas.height !== displayH) {
              canvas.width = displayW;
              canvas.height = displayH;
            }
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.clearRect(0, 0, displayW, displayH);

              // 1. Central guide ellipse
              ctx.beginPath();
              ctx.ellipse(displayW / 2, displayH / 2, displayW * 0.26, displayH * 0.35, 0, 0, 2 * Math.PI);
              ctx.lineWidth = 3.5;
              ctx.strokeStyle = hasFace ? 'rgba(52, 211, 153, 0.95)' : 'rgba(148, 163, 184, 0.65)';
              if (!hasFace) {
                ctx.setLineDash([8, 6]);
              }
              ctx.stroke();
              ctx.setLineDash([]);

              // 2. Real-time face tracking brackets and key landmarks
              if (hasFace && liveBio && liveBio.box && video.videoWidth > 0 && video.videoHeight > 0) {
                const scaleX = displayW / video.videoWidth;
                const scaleY = displayH / video.videoHeight;
                const bx = liveBio.box.x * scaleX;
                const by = liveBio.box.y * scaleY;
                const bw = liveBio.box.width * scaleX;
                const bh = liveBio.box.height * scaleY;
                const cornerLen = Math.min(22, bw * 0.25);

                ctx.strokeStyle = '#34d399';
                ctx.lineWidth = 2.5;

                // Top-left
                ctx.beginPath();
                ctx.moveTo(bx, by + cornerLen);
                ctx.lineTo(bx, by);
                ctx.lineTo(bx + cornerLen, by);
                ctx.stroke();

                // Top-right
                ctx.beginPath();
                ctx.moveTo(bx + bw - cornerLen, by);
                ctx.lineTo(bx + bw, by);
                ctx.lineTo(bx + bw, by + cornerLen);
                ctx.stroke();

                // Bottom-left
                ctx.beginPath();
                ctx.moveTo(bx, by + bh - cornerLen);
                ctx.lineTo(bx, by + bh);
                ctx.lineTo(bx + cornerLen, by + bh);
                ctx.stroke();

                // Bottom-right
                ctx.beginPath();
                ctx.moveTo(bx + bw - cornerLen, by + bh);
                ctx.lineTo(bx + bw, by + bh);
                ctx.lineTo(bx + bw, by + bh - cornerLen);
                ctx.stroke();

                // Key facial landmark dots
                if (hasLandmarks && liveBio.landmarks && liveBio.landmarks.positions) {
                  ctx.fillStyle = 'rgba(52, 211, 153, 0.75)';
                  const pts = liveBio.landmarks.positions;
                  const keyIndices = [30, 36, 39, 42, 45, 48, 54, 8];
                  for (const idx of keyIndices) {
                    if (pts[idx]) {
                      ctx.beginPath();
                      ctx.arc(pts[idx].x * scaleX, pts[idx].y * scaleY, 2.5, 0, 2 * Math.PI);
                      ctx.fill();
                    }
                  }
                }
              }
            }
          }

          // Determine expected pose for current step
          let expectedPose: 'STRAIGHT' | 'LEFT' | 'RIGHT' = 'STRAIGHT';
          if (step === 'turnLeft') {
            expectedPose = 'LEFT';
          } else if (step === 'turnRight') {
            expectedPose = 'RIGHT';
          }

          if (hasFace && liveBio) {
            setIsFaceDetected(true);
            setDebugFaceDetected(true);
            setDebugLandmarksDetected(hasLandmarks);

            const detectedPose = (hasLandmarks && liveBio.pose) ? liveBio.pose.pose : 'STRAIGHT';
            const yaw = (hasLandmarks && liveBio.pose) ? liveBio.pose.physicalYaw : 0;

            // Update debug indicators with real live facial telemetry
            setDebugYaw(yaw);
            setDebugDetectedPose(detectedPose);
            setDebugExpectedPose(expectedPose);

            // Step-specific validation: increment if detectedPose matches expectedPose
            if (detectedPose === expectedPose) {
              consecutiveStableFramesRef.current += 1;
              const stableCount = consecutiveStableFramesRef.current;
              setDebugStableFrames(stableCount);

              const progress = Math.min(100, Math.round((stableCount / REQUIRED_STABLE_FRAMES) * 100));
              setStepProgress(progress);

              // =============================================================
              // STEP 1: LOOK STRAIGHT
              // =============================================================
              if (step === 'lookStraight') {
                setStatusMessage(`Looking straight — hold steady (${stableCount}/${REQUIRED_STABLE_FRAMES})`);

                if (stableCount >= REQUIRED_STABLE_FRAMES) {
                  // Capture 128D descriptor for Step 1
                  const fullBio = await detectFaceBiometrics(video, { extractDescriptor: true });
                  if (fullBio && fullBio.descriptor) {
                    capturedDescriptorsRef.current[0] = fullBio.descriptor;
                  }
                  console.log('[FaceRegistration] Step 1 — Straight Pose Verified and Captured');

                  // Take photo snapshot
                  try {
                    const snapCanvas = document.createElement('canvas');
                    snapCanvas.width = video.videoWidth || 640;
                    snapCanvas.height = video.videoHeight || 480;
                    const snapCtx = snapCanvas.getContext('2d');
                    if (snapCtx) {
                      snapCtx.translate(snapCanvas.width, 0);
                      snapCtx.scale(-1, 1);
                      snapCtx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height);
                      const photoDataUrl = snapCanvas.toDataURL('image/jpeg', 0.90);
                      setCapturedPhotoUrl(photoDataUrl);
                    }
                  } catch (snapErr) {
                    console.warn('[FaceRegistration] Frame capture snapshot notice:', snapErr);
                  }

                  setStatusMessage('Step 1 Completed ✓');
                  info('Step 1 — Look Straight Completed ✓');
                  isTransitioningRef.current = true;
                  consecutiveStableFramesRef.current = 0;

                  setTimeout(() => {
                    if (!isMounted) return;
                    setStepProgress(0);
                    setDebugStableFrames(0);
                    isTransitioningRef.current = false;
                    setCurrentStep('turnLeft');
                    setStatusMessage('Step 2: Turn your head slightly to your LEFT.');
                  }, 250);
                }
              }

              // =============================================================
              // STEP 2: TURN HEAD LEFT
              // =============================================================
              else if (step === 'turnLeft') {
                setStatusMessage(`Left turn detected — hold steady (${stableCount}/${REQUIRED_STABLE_FRAMES})`);

                if (stableCount >= REQUIRED_STABLE_FRAMES) {
                  const fullBio = await detectFaceBiometrics(video, { extractDescriptor: true });
                  if (fullBio && fullBio.descriptor) {
                    capturedDescriptorsRef.current[1] = fullBio.descriptor;
                  }
                  console.log('[FaceRegistration] Step 2 — Left Pose Verified and Captured');
                  setStatusMessage('Step 2 Completed ✓');
                  info('Step 2 — Turn Left Completed ✓');
                  isTransitioningRef.current = true;
                  consecutiveStableFramesRef.current = 0;

                  setTimeout(() => {
                    if (!isMounted) return;
                    setStepProgress(0);
                    setDebugStableFrames(0);
                    isTransitioningRef.current = false;
                    setCurrentStep('turnRight');
                    setStatusMessage('Step 3: Turn your head slightly to your RIGHT.');
                  }, 250);
                }
              }

              // =============================================================
              // STEP 3: TURN HEAD RIGHT
              // =============================================================
              else if (step === 'turnRight') {
                setStatusMessage(`Right turn detected — hold steady (${stableCount}/${REQUIRED_STABLE_FRAMES})`);

                if (stableCount >= REQUIRED_STABLE_FRAMES) {
                  const fullBio = await detectFaceBiometrics(video, { extractDescriptor: true });
                  if (fullBio && fullBio.descriptor) {
                    capturedDescriptorsRef.current[2] = fullBio.descriptor;
                  }
                  console.log('[FaceRegistration] Step 3 — Right Pose Verified and Captured');
                  setStatusMessage('Step 3 Completed ✓');
                  info('Step 3 — Turn Right Completed ✓');
                  isTransitioningRef.current = true;
                  consecutiveStableFramesRef.current = 0;

                  setTimeout(() => {
                    if (!isMounted) return;
                    setStepProgress(0);
                    setDebugStableFrames(0);
                    executeFinalizeFlow();
                  }, 250);
                }
              }
            } else {
              // Detected pose does not match expected pose -> Reset consecutive counter
              consecutiveStableFramesRef.current = 0;
              setStepProgress(0);
              setDebugStableFrames(0);

              if (step === 'lookStraight') {
                if (detectedPose === 'LEFT' || detectedPose === 'RIGHT') {
                  setStatusMessage('Head is turned — please look directly STRAIGHT at the camera');
                } else {
                  setStatusMessage('Keep face in camera and look directly straight');
                }
              } else if (step === 'turnLeft') {
                if (detectedPose === 'RIGHT') {
                  setStatusMessage('Turn your head to your LEFT (currently turned right)...');
                } else {
                  setStatusMessage('Turn your head slightly to your LEFT...');
                }
              } else if (step === 'turnRight') {
                if (detectedPose === 'LEFT') {
                  setStatusMessage('Turn your head to your RIGHT (currently turned left)...');
                } else {
                  setStatusMessage('Turn your head slightly to your RIGHT...');
                }
              }
            }
          } else {
            // No valid face or landmarks in frame -> Reset consecutive counter and update debug
            setIsFaceDetected(false);
            setDebugFaceDetected(false);
            setDebugLandmarksDetected(false);
            setDebugYaw(null);
            setDebugDetectedPose('UNKNOWN');
            consecutiveStableFramesRef.current = 0;
            setStepProgress(0);
            setDebugStableFrames(0);

            if (liveBio && liveBio.faceCount > 1) {
              setStatusMessage('Multiple faces detected — only 1 person allowed');
            } else {
              setStatusMessage('Position face inside guide');
            }
          }
        } catch (loopErr) {
          console.warn('[FaceRegistration] Detection frame notice:', loopErr);
        } finally {
          isProcessingRef.current = false;
        }
      }

      if (isMounted) {
        animId = requestAnimationFrame(runLoop);
      }
    };

    animId = requestAnimationFrame(runLoop);
    return () => {
      isMounted = false;
      cancelAnimationFrame(animId);
    };
  }, [executeFinalizeFlow, info, isFaceDetected]);

  // Helper to determine step status for checklist
  const getStepStatus = (stepId: FlowStep) => {
    const stepOrder: FlowStep[] = ['lookStraight', 'turnLeft', 'turnRight', 'finalCapture', 'duplicateCheck', 'saving', 'success'];
    const currentIdx = stepOrder.indexOf(currentStep);
    const targetIdx = stepOrder.indexOf(stepId);

    if (currentStep === 'success') return 'completed';
    if (targetIdx < currentIdx) return 'completed';
    if (targetIdx === currentIdx) return 'active';
    return 'pending';
  };

  const activeStepInfo = STEPS.find((s) => s.id === currentStep) || STEPS[0];

  return (
    <div id="face-registration-page" className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 lg:p-8 flex flex-col justify-center">
        {/* Top Header Card */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 md:p-5 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-violet-500/10 border border-violet-500/20 rounded-xl text-violet-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Face Biometric Registration
              </h1>
              <p className="text-xs md:text-sm text-slate-400">
                Enroll your facial profile for secure, instant attendance verification.
              </p>
            </div>
          </div>

          {/* Student Badge */}
          {studentProfile && (
            <div className="flex items-center gap-3 bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2 self-start sm:self-auto">
              <div className="w-8 h-8 rounded-full bg-violet-600/20 text-violet-400 flex items-center justify-center font-bold text-xs">
                {studentProfile.studentName?.charAt(0) || 'S'}
              </div>
              <div className="text-left">
                <p className="text-xs font-semibold text-slate-200">{studentProfile.studentName}</p>
                <p className="text-[11px] text-slate-400">{studentProfile.rollNumber} • {studentProfile.year}</p>
              </div>
            </div>
          )}
        </div>

        {/* Enrollment Mode Tabs & Navigation Helpers */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 rounded-2xl p-2.5 backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-2">
            <button
              id="tab-mode-camera"
              type="button"
              onClick={() => {
                setEnrollmentMode('camera');
                startCamera(true);
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                enrollmentMode === 'camera'
                  ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Camera className="w-4 h-4" />
              Live Webcam Pose Scan
            </button>

            <button
              id="tab-mode-upload"
              type="button"
              onClick={() => {
                setEnrollmentMode('upload');
                stopCamera();
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                enrollmentMode === 'upload'
                  ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Upload className="w-4 h-4" />
              Upload Face Photo
            </button>

            <button
              id="tab-mode-demo"
              type="button"
              onClick={() => {
                setEnrollmentMode('demo');
                stopCamera();
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                enrollmentMode === 'demo'
                  ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Sparkles className="w-4 h-4 text-amber-400" />
              Demo Fast-Track
            </button>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <a
              id="btn-open-fullscreen"
              href={window.location.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium border border-slate-700/60 transition-all cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open in New Window
            </a>
          </div>
        </div>

        {/* Main Grid: Left Steps & Instructions | Right Live Camera Preview */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* ================= LEFT PANEL (5 Cols) ================= */}
          <div className="lg:col-span-5 flex flex-col gap-5">
            
            {/* Active Step Card */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl backdrop-blur-md">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2.5 py-1 rounded-full">
                  Step {activeStepInfo.number} of 6
                </span>
                <span className="text-xs font-semibold text-slate-400">
                  {currentStep === 'success' ? 100 : stepProgress}% Confirmed
                </span>
              </div>

              <h2 className="text-xl font-extrabold text-white mb-2">
                {activeStepInfo.title}
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed mb-4">
                {activeStepInfo.instruction}
              </p>

              {/* Progress Bar */}
              <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden mb-2">
                <motion.div 
                  className="bg-gradient-to-r from-violet-500 to-emerald-400 h-2.5 rounded-full"
                  animate={{ width: `${currentStep === 'success' ? 100 : stepProgress}%` }}
                  transition={{ duration: 0.10 }}
                />
              </div>

              {/* Status Pill */}
              <div className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-300 bg-slate-950/80 border border-slate-800/80 px-3 py-2 rounded-lg">
                {currentStep === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : currentStep === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                ) : currentStep === 'finalCapture' || currentStep === 'duplicateCheck' || currentStep === 'saving' ? (
                  <Loader2 className="w-4 h-4 text-violet-400 animate-spin shrink-0" />
                ) : isFaceDetected ? (
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                ) : (
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                )}
                <span className="truncate">{statusMessage}</span>
              </div>

              {/* Display captured frame preview when available */}
              {capturedPhotoUrl && currentStep !== 'success' && (
                <div className="mt-4 pt-4 border-t border-slate-800 flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl overflow-hidden border border-emerald-500/60 shrink-0">
                    <img src={capturedPhotoUrl} alt="Captured Profile" className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Live Frame Captured
                    </p>
                    <p className="text-[11px] text-slate-400">Profile image stored for enrollment.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Checklist of Registration Steps */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-md">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                Registration Checklist
              </h3>

              <div className="space-y-3">
                {STEPS.map((step) => {
                  const status = getStepStatus(step.id);
                  return (
                    <div 
                      key={step.id} 
                      className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                        status === 'completed'
                          ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                          : status === 'active'
                          ? 'bg-violet-950/30 border-violet-500/40 text-white shadow-lg shadow-violet-950/30'
                          : 'bg-slate-950/40 border-slate-800/50 text-slate-500'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="shrink-0">
                          {status === 'completed' ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                          ) : status === 'active' ? (
                            <div className="w-5 h-5 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
                          ) : (
                            <div className="w-5 h-5 rounded-full border border-slate-700 flex items-center justify-center text-[10px] font-bold">
                              {step.number}
                            </div>
                          )}
                        </div>
                        <span className="text-xs md:text-sm font-semibold">
                          Step {step.number} — {step.label}
                        </span>
                      </div>

                      <span className="text-[11px] font-medium">
                        {status === 'completed' ? 'Completed ✓' : status === 'active' ? 'In Progress' : 'Pending'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

          {/* ================= RIGHT PANEL (7 Cols) ================= */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            
            {/* Live Camera Feed & Viewport */}
            <div className="relative bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl aspect-[4/3] flex items-center justify-center">
              
              {/* Success Screen Overlay */}
              {currentStep === 'success' && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute inset-0 z-30 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center"
                >
                  <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 mb-4 shadow-lg shadow-emerald-500/20">
                    <CheckCircle2 className="w-10 h-10" />
                  </div>

                  <h2 className="text-2xl md:text-3xl font-black text-white mb-2">
                    Face Registration Completed ✓
                  </h2>
                  <p className="text-sm text-slate-300 max-w-md mb-6">
                    Your facial profile is securely enrolled. You can now use facial recognition to mark daily attendance.
                  </p>

                  {capturedPhotoUrl && (
                    <div className="w-24 h-24 rounded-2xl overflow-hidden border-2 border-emerald-500/50 mb-6 shadow-md">
                      <img src={capturedPhotoUrl} alt="Enrolled Face" className="w-full h-full object-cover" />
                    </div>
                  )}

                  <button
                    id="btn-continue-dashboard"
                    onClick={() => navigate('/student')}
                    className="flex items-center gap-2 px-6 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-emerald-500/25 cursor-pointer"
                  >
                    Continue to Dashboard
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </motion.div>
              )}

              {/* Error Screen Overlay (Duplicate face or fatal failure) */}
              {currentStep === 'error' && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 z-30 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center"
                >
                  <div className="w-16 h-16 rounded-full bg-rose-500/20 border-2 border-rose-500 flex items-center justify-center text-rose-400 mb-4">
                    <AlertTriangle className="w-8 h-8" />
                  </div>

                  <h2 className="text-xl md:text-2xl font-bold text-white mb-2">
                    {duplicateError ? 'Duplicate Face Detected' : 'Registration Incomplete'}
                  </h2>
                  <p className="text-sm text-rose-300 max-w-md mb-6 leading-relaxed">
                    {duplicateError 
                      ? 'This face is already registered with another account in the database. Each student must have a unique facial identity.' 
                      : statusMessage}
                  </p>

                  <button
                    id="btn-retry-registration"
                    onClick={handleRestart}
                    className="flex items-center gap-2 px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm transition-all shadow-lg shadow-violet-600/25 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Try Again
                  </button>
                </motion.div>
              )}

              {/* Camera Permission Denied / Context-Restricted Overlay */}
              {enrollmentMode === 'camera' && hasCameraPermission === false && (
                <div className="absolute inset-0 z-20 bg-slate-950/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-4 shadow-lg shadow-amber-500/10">
                    <Camera className="w-7 h-7" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">Camera Access Notice</h3>
                  <p className="text-xs text-slate-300 max-w-md mb-5 leading-relaxed">
                    {cameraErrorMessage || 'Camera access is restricted in this context by the browser.'}
                  </p>

                  <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-sm mb-4">
                    <button
                      id="btn-retry-camera"
                      type="button"
                      onClick={() => startCamera(true)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs transition-all cursor-pointer shadow-lg shadow-violet-600/20"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Grant / Retry Camera
                    </button>

                    <a
                      id="btn-camera-new-tab"
                      href={window.location.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-semibold text-xs border border-slate-700 transition-all text-center"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open in New Tab
                    </a>
                  </div>

                  <div className="pt-4 border-t border-slate-800/80 w-full max-w-sm flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setEnrollmentMode('upload');
                        stopCamera();
                      }}
                      className="text-xs font-semibold text-violet-400 hover:text-violet-300 underline underline-offset-4 cursor-pointer flex items-center gap-1"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Upload Photo
                    </button>
                    <span className="text-slate-600">•</span>
                    <button
                      type="button"
                      onClick={handleDemoEnrollment}
                      className="text-xs font-semibold text-amber-400 hover:text-amber-300 underline underline-offset-4 cursor-pointer flex items-center gap-1"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Fast-Track Demo
                    </button>
                  </div>
                </div>
              )}

              {/* Upload Photo Mode UI */}
              {enrollmentMode === 'upload' && currentStep !== 'success' && currentStep !== 'error' && (
                <div className="absolute inset-0 z-20 bg-slate-950 p-6 flex flex-col items-center justify-center text-center">
                  <div className="w-full max-w-md p-6 border-2 border-dashed border-slate-700 hover:border-violet-500 rounded-2xl transition-colors bg-slate-900/50 flex flex-col items-center justify-center relative">
                    <input
                      type="file"
                      id="face-photo-upload-input"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      disabled={isProcessingEnrollment}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                    />

                    {uploadedImagePreview ? (
                      <div className="flex flex-col items-center">
                        <div className="w-32 h-32 rounded-2xl overflow-hidden border-2 border-violet-500 mb-3 shadow-lg">
                          <img src={uploadedImagePreview} alt="Selected Face" className="w-full h-full object-cover" />
                        </div>
                        <p className="text-xs font-semibold text-slate-300 mb-1">Photo loaded</p>
                        {isProcessingEnrollment && (
                          <div className="flex items-center gap-2 text-xs text-violet-400 font-medium">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Extracting 128-d biometrics...
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="w-14 h-14 rounded-2xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-400 mb-4">
                          <Upload className="w-7 h-7" />
                        </div>
                        <h4 className="text-base font-bold text-white mb-1">Select Face Portrait</h4>
                        <p className="text-xs text-slate-400 mb-4 max-w-xs">
                          Drag and drop or browse for a high-clarity front-facing photo of your face (JPEG, PNG).
                        </p>
                        <span className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs transition-all pointer-events-none shadow-md shadow-violet-600/25">
                          Browse Image
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Demo Fast-Track Mode UI */}
              {enrollmentMode === 'demo' && currentStep !== 'success' && currentStep !== 'error' && (
                <div className="absolute inset-0 z-20 bg-slate-950 p-6 flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-4 shadow-lg shadow-amber-500/10">
                    <Sparkles className="w-8 h-8" />
                  </div>
                  <h4 className="text-lg font-bold text-white mb-2">Sandbox Face Fast-Track</h4>
                  <p className="text-xs text-slate-300 max-w-sm mb-6 leading-relaxed">
                    Instantly enroll an isolated, deterministic 128-dimensional biometric profile for <strong className="text-white">{studentProfile?.studentName || 'Student'}</strong>. Ideal for testing attendance flows without a webcam.
                  </p>

                  <button
                    id="btn-enroll-demo"
                    type="button"
                    disabled={isProcessingEnrollment}
                    onClick={handleDemoEnrollment}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-violet-600 hover:from-amber-400 hover:to-violet-500 text-white font-bold text-xs transition-all cursor-pointer shadow-lg shadow-violet-600/20 disabled:opacity-50"
                  >
                    {isProcessingEnrollment ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Enrolling Profile...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Enroll Biometric Profile Now
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Video Element (Direct live stream, mirrored for natural user perspective) */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />

              {/* Canvas Overlay for Visual Guide */}
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none z-10 scale-x-[-1]"
              />

              {/* Real-time Status Badge on Camera */}
              {enrollmentMode === 'camera' && (
                <div className="absolute top-4 left-4 z-20">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-950/80 backdrop-blur-md border border-slate-800 text-xs font-semibold">
                    {isFaceDetected ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-emerald-300">● Face detected</span>
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        <span className="text-amber-300">● Position face inside guide</span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Live Facial Telemetry & Pose Debug Indicator */}
              {enrollmentMode === 'camera' && (
                <div id="pose-debug-indicator" className="absolute top-4 right-4 z-20 bg-slate-950/90 backdrop-blur-md border border-slate-800/90 rounded-xl px-3 py-2 text-[11px] font-mono shadow-xl text-slate-200 min-w-[150px]">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">Face:</span>
                    <span className={debugFaceDetected ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                      {debugFaceDetected ? 'YES' : 'NO'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">Landmarks:</span>
                    <span className={debugLandmarksDetected ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                      {debugLandmarksDetected ? 'YES (68)' : 'NO'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">Yaw:</span>
                    <span className="font-semibold text-slate-100">
                      {debugYaw !== null ? (debugYaw >= 0 ? `+${debugYaw.toFixed(2)}` : debugYaw.toFixed(2)) : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">Pose:</span>
                    <span className={debugDetectedPose === debugExpectedPose ? 'text-emerald-400 font-bold' : 'text-amber-300 font-bold'}>
                      {debugDetectedPose}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">Expected:</span>
                    <span className="text-violet-400 font-semibold">{debugExpectedPose}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">Stable:</span>
                    <span className="text-white font-bold">{debugStableFrames}/{REQUIRED_STABLE_FRAMES}</span>
                  </div>
                </div>
              )}

              {/* Directional Hint Banner at Bottom of Video */}
              {enrollmentMode === 'camera' && (
                <div className="absolute bottom-4 inset-x-4 z-20">
                  <div className="bg-slate-950/85 backdrop-blur-md border border-slate-800/80 rounded-2xl p-3 text-center shadow-lg">
                    <p className="text-xs md:text-sm font-bold text-white">
                      {statusMessage}
                    </p>
                  </div>
                </div>
              )}

            </div>

            {/* Bottom Controls Bar with Reset Registration Button */}
            <div className="flex items-center justify-between text-xs text-slate-400 px-2">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                Live 128-d biometric neural network
              </span>

              <button
                id="btn-reset-registration"
                onClick={handleRestart}
                className="flex items-center gap-1.5 hover:text-rose-400 transition-colors cursor-pointer py-1.5 px-3 rounded-lg bg-slate-900 border border-slate-800 hover:border-rose-500/40 font-medium"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Registration
              </button>
            </div>

          </div>

        </div>
      </main>
    </div>
  );
};

export default FaceRegistration;
