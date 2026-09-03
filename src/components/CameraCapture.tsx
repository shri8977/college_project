import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Camera,
  RotateCcw,
  Check,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  ShieldCheck,
  Video,
  VideoOff,
  FlipHorizontal,
  Sparkles,
  UserCheck,
  Eye,
  Info,
  X,
  Lock,
  ChevronDown
} from 'lucide-react';
import {
  detectFaceBiometrics,
  loadFaceApiModels,
  LiveBiometricsResult,
  formatTime12hr
} from '../utils/faceUtils';

export interface CameraCaptureResult {
  imageSrc: string; // Base64 Data URL (image/jpeg)
  blob: Blob | null;
  width: number;
  height: number;
  descriptor?: number[];
  landmarks?: any;
  biometrics?: LiveBiometricsResult | null;
  timestamp: number;
}

export interface CameraCaptureProps {
  onCapture?: (result: CameraCaptureResult) => void;
  onCancel?: () => void;
  title?: string;
  subtitle?: string;
  requireFaceDetected?: boolean;
  autoAnalyze?: boolean;
  initialFacingMode?: 'user' | 'environment';
  confirmText?: string;
  className?: string;
  showMirrorToggle?: boolean;
  showDeviceSelect?: boolean;
  compact?: boolean;
}

type PermissionStatusType = 'checking' | 'prompt' | 'granted' | 'denied' | 'unsupported';

export const CameraCapture: React.FC<CameraCaptureProps> = ({
  onCapture,
  onCancel,
  title = 'Face Capture',
  subtitle = 'Position your face clearly within the frame',
  requireFaceDetected = false,
  autoAnalyze = true,
  initialFacingMode = 'user',
  confirmText = 'Use Snapshot',
  className = '',
  showMirrorToggle = true,
  showDeviceSelect = true,
  compact = false,
}) => {
  // Video and canvas elements
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Camera permissions & state
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatusType>('checking');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<'denied' | 'not-found' | 'busy' | 'unsupported' | 'generic' | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isMirrored, setIsMirrored] = useState(initialFacingMode === 'user');
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(initialFacingMode);

  // Live face tracking & biometrics
  const [isModelsLoaded, setIsModelsLoaded] = useState(false);
  const [liveBiometrics, setLiveBiometrics] = useState<LiveBiometricsResult | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [faceCount, setFaceCount] = useState(0);

  // Snapshot capture state
  const [isCaptured, setIsCaptured] = useState(false);
  const [capturedImageSrc, setCapturedImageSrc] = useState<string | null>(null);
  const [capturedBiometrics, setCapturedBiometrics] = useState<LiveBiometricsResult | null>(null);
  const [isAnalyzingSnapshot, setIsAnalyzingSnapshot] = useState(false);
  const [flashEffect, setFlashEffect] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Cleanup helper to cleanly release media stream
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraReady(false);
  }, []);

  // Play a gentle synthetic shutter audio sound using Web Audio API
  const playShutterSound = useCallback(() => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    } catch {
      // Audio playback failure is non-blocking
    }
  }, []);

  // Enumerate video devices
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      setAvailableDevices(videoInputs);
    } catch (err) {
      console.warn('[CameraCapture] enumerateDevices caught:', err);
    }
  }, []);

  // Initialize camera with robust error handling
  const startCamera = useCallback(async (deviceIdToUse?: string) => {
    setPermissionStatus('checking');
    setErrorMessage(null);
    setErrorType(null);
    stopStream();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPermissionStatus('unsupported');
      setErrorType('unsupported');
      setErrorMessage('Camera access is not supported by your current browser environment.');
      return;
    }

    // Build constraints
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: deviceIdToUse
        ? { deviceId: { exact: deviceIdToUse } }
        : {
            facingMode: facingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
    };

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (firstErr) {
        // Fallback to minimal video constraint if ideal width/height failed
        console.warn('[CameraCapture] HD constraint fallback:', firstErr);
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      streamRef.current = stream;
      setPermissionStatus('granted');

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current
            ?.play()
            .then(() => {
              setIsCameraReady(true);
              refreshDevices();
            })
            .catch((playErr) => {
              console.warn('[CameraCapture] Video play catch:', playErr);
            });
        };
      }
    } catch (err: any) {
      console.warn('[CameraCapture] getUserMedia notice:', err?.message || err);
      const name = err?.name || '';

      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setPermissionStatus('denied');
        setErrorType('denied');
        setErrorMessage(
          'Camera access was denied. Please allow camera permissions in your browser address bar to use face recognition.'
        );
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setPermissionStatus('denied');
        setErrorType('not-found');
        setErrorMessage('No camera device was detected on your system. Please connect a webcam.');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setPermissionStatus('denied');
        setErrorType('busy');
        setErrorMessage(
          'Camera is currently in use by another program or browser tab. Please close other applications using the camera.'
        );
      } else {
        setPermissionStatus('denied');
        setErrorType('generic');
        setErrorMessage(err?.message || 'Unable to start camera. Please check your system settings.');
      }
    }
  }, [facingMode, refreshDevices, stopStream]);

  // Check initial permissions API if supported
  useEffect(() => {
    let active = true;

    const checkPermissionApi = async () => {
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
          if (active) {
            if (status.state === 'denied') {
              setPermissionStatus('denied');
              setErrorType('denied');
              setErrorMessage(
                'Camera permission is blocked. Click the lock/camera icon in your address bar to allow camera access.'
              );
              return;
            }
          }
          status.onchange = () => {
            if (active && status.state === 'granted') {
              startCamera();
            }
          };
        }
      } catch {
        // permissions.query for camera is not supported in all browsers
      }

      if (active) {
        startCamera();
      }
    };

    checkPermissionApi();

    return () => {
      active = false;
      stopStream();
    };
  }, [startCamera, stopStream]);

  // Load face-api models in background for real-time guidance
  useEffect(() => {
    let mounted = true;
    loadFaceApiModels()
      .then(() => {
        if (mounted) setIsModelsLoaded(true);
      })
      .catch((err) => {
        console.warn('[CameraCapture] Models load note:', err);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Live real-time face detection loop
  useEffect(() => {
    if (!isCameraReady || isCaptured || !isModelsLoaded || permissionStatus !== 'granted') {
      return;
    }

    let animationId: number;
    let isSubscribed = true;
    let lastCheckTime = 0;

    const runDetection = async (time: number) => {
      // Throttle detection to ~5 FPS to keep UI fast and save CPU
      if (time - lastCheckTime > 200 && videoRef.current && videoRef.current.readyState >= 2) {
        lastCheckTime = time;
        setIsDetecting(true);
        try {
          // Fast landmark detection without full descriptor during live feed
          const result = await detectFaceBiometrics(videoRef.current, {
            extractDescriptor: false,
            inputSize: 224,
            scoreThreshold: 0.2,
          });

          if (isSubscribed) {
            setLiveBiometrics(result);
            setFaceCount(result ? result.faceCount : 0);
          }
        } catch {
          // non-fatal
        } finally {
          if (isSubscribed) {
            setIsDetecting(false);
          }
        }
      }

      if (isSubscribed) {
        animationId = requestAnimationFrame(runDetection);
      }
    };

    animationId = requestAnimationFrame(runDetection);

    return () => {
      isSubscribed = false;
      cancelAnimationFrame(animationId);
    };
  }, [isCameraReady, isCaptured, isModelsLoaded, permissionStatus]);

  // Handle Snapshot Execution
  const takeSnapshot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    // Shutter flash & sound
    setFlashEffect(true);
    playShutterSound();
    setTimeout(() => setFlashEffect(false), 200);

    const videoW = video.videoWidth || 640;
    const videoH = video.videoHeight || 480;

    // Offscreen canvas for full-resolution snapshot
    const canvas = document.createElement('canvas');
    canvas.width = videoW;
    canvas.height = videoH;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    // Apply mirroring if enabled so saved image matches user perception
    if (isMirrored) {
      ctx.translate(videoW, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, videoW, videoH);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    setCapturedImageSrc(dataUrl);
    setIsCaptured(true);

    // Stop video track playback while previewing
    video.pause();

    // Biometric analysis of captured snapshot
    if (autoAnalyze && isModelsLoaded) {
      setIsAnalyzingSnapshot(true);
      try {
        const biometrics = await detectFaceBiometrics(canvas, {
          extractDescriptor: true,
          inputSize: 320,
          scoreThreshold: 0.15,
        });
        setCapturedBiometrics(biometrics);
      } catch (err) {
        console.warn('[CameraCapture] Snapshot analysis catch:', err);
      } finally {
        setIsAnalyzingSnapshot(false);
      }
    }
  }, [autoAnalyze, isMirrored, isModelsLoaded, playShutterSound]);

  // Handle Countdown Timer
  const startCountdown = useCallback(
    (seconds: number = 3) => {
      setCountdown(seconds);
      const interval = setInterval(() => {
        setCountdown((prev) => {
          if (prev === null || prev <= 1) {
            clearInterval(interval);
            takeSnapshot();
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    },
    [takeSnapshot]
  );

  // Retake photo: discard snapshot and resume live camera feed
  const retakePhoto = useCallback(() => {
    setIsCaptured(false);
    setCapturedImageSrc(null);
    setCapturedBiometrics(null);
    setIsAnalyzingSnapshot(false);
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, []);

  // Confirm snapshot and invoke callback
  const handleConfirm = useCallback(() => {
    if (!capturedImageSrc) return;

    // Convert dataUrl to blob
    const byteString = atob(capturedImageSrc.split(',')[1]);
    const mimeString = capturedImageSrc.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: mimeString });

    const result: CameraCaptureResult = {
      imageSrc: capturedImageSrc,
      blob,
      width: videoRef.current?.videoWidth || 640,
      height: videoRef.current?.videoHeight || 480,
      descriptor: capturedBiometrics?.descriptor,
      landmarks: capturedBiometrics?.landmarks,
      biometrics: capturedBiometrics,
      timestamp: Date.now(),
    };

    if (onCapture) {
      onCapture(result);
    }
  }, [capturedBiometrics, capturedImageSrc, onCapture]);

  // Face status calculation
  const hasFace = Boolean(liveBiometrics && liveBiometrics.faceCount > 0);
  const isMultipleFaces = Boolean(liveBiometrics && liveBiometrics.faceCount > 1);
  const isCentered = Boolean(liveBiometrics?.isCentered);

  return (
    <div
      id="camera-capture-container"
      className={`relative flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xl overflow-hidden ${className}`}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-violet-600/10 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400">
            <Camera className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-white leading-tight">
              {title}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {subtitle}
            </p>
          </div>
        </div>

        {onCancel && (
          <button
            id="camera-capture-close-button"
            onClick={() => {
              stopStream();
              onCancel();
            }}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Cancel"
            aria-label="Cancel"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Main Viewport */}
      <div className="relative w-full aspect-[4/3] bg-slate-950 flex items-center justify-center overflow-hidden">
        {/* Hidden internal canvas for sizing calculations */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Video Element */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover transition-transform duration-200 ${
            isMirrored ? 'scale-x-[-1]' : ''
          } ${isCaptured ? 'hidden' : 'block'}`}
        />

        {/* Captured Snapshot Display */}
        {isCaptured && capturedImageSrc && (
          <div className="relative w-full h-full flex items-center justify-center bg-slate-950">
            <img
              src={capturedImageSrc}
              alt="Captured Snapshot"
              className="w-full h-full object-cover"
            />
            {/* Shutter flash animation */}
            <AnimatePresence>
              {flashEffect && (
                <motion.div
                  initial={{ opacity: 0.9 }}
                  animate={{ opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 bg-white pointer-events-none z-30"
                />
              )}
            </AnimatePresence>

            {/* Analysis Badge */}
            {isAnalyzingSnapshot && (
              <div className="absolute top-4 left-4 right-4 flex items-center justify-center gap-2 bg-slate-900/80 backdrop-blur-md px-3.5 py-2 rounded-xl text-xs font-medium text-violet-300 border border-violet-500/30 shadow-lg">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-violet-400" />
                Analyzing facial biometrics & embedding...
              </div>
            )}
          </div>
        )}

        {/* Live Face Alignment Guide Overlay (when not captured and camera active) */}
        {!isCaptured && isCameraReady && permissionStatus === 'granted' && (
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
            {/* Oval Face Silhouette Guide */}
            <div
              className={`relative w-56 h-72 sm:w-64 sm:h-80 rounded-[50%] border-2 border-dashed transition-all duration-300 ${
                isMultipleFaces
                  ? 'border-amber-400/80 shadow-[0_0_20px_rgba(251,191,36,0.3)]'
                  : hasFace && isCentered
                  ? 'border-emerald-400/90 shadow-[0_0_25px_rgba(52,211,153,0.35)]'
                  : 'border-white/40 shadow-[0_0_15px_rgba(255,255,255,0.15)]'
              }`}
            >
              {/* Corner Viewfinder Brackets */}
              <div className="absolute -top-3 -left-3 w-6 h-6 border-t-2 border-l-2 border-white/80 rounded-tl" />
              <div className="absolute -top-3 -right-3 w-6 h-6 border-t-2 border-r-2 border-white/80 rounded-tr" />
              <div className="absolute -bottom-3 -left-3 w-6 h-6 border-b-2 border-l-2 border-white/80 rounded-bl" />
              <div className="absolute -bottom-3 -right-3 w-6 h-6 border-b-2 border-r-2 border-white/80 rounded-br" />

              {/* Center crosshair */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1px] h-4 bg-white/30" />
                <div className="absolute top-1/2 left-0 -translate-y-1/2 w-4 h-[1px] bg-white/30" />
              </div>
            </div>

            {/* Real-time status feedback pill */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-auto">
              {isMultipleFaces ? (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/90 text-slate-950 text-xs font-semibold backdrop-blur-md shadow-md">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Multiple faces detected (only 1 person allowed)
                </div>
              ) : hasFace && isCentered ? (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/90 text-white text-xs font-semibold backdrop-blur-md shadow-md animate-pulse">
                  <UserCheck className="w-3.5 h-3.5" />
                  Face detected & centered
                </div>
              ) : hasFace ? (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/90 text-white text-xs font-medium backdrop-blur-md shadow-md">
                  <Eye className="w-3.5 h-3.5" />
                  Align face to center of oval
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/80 text-slate-300 text-xs font-medium border border-slate-700/60 backdrop-blur-md shadow-md">
                  <Info className="w-3.5 h-3.5 text-slate-400" />
                  Position face inside the oval
                </div>
              )}
            </div>
          </div>
        )}

        {/* Shutter flash animation for live mode */}
        <AnimatePresence>
          {flashEffect && (
            <motion.div
              initial={{ opacity: 0.9 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-white pointer-events-none z-30"
            />
          )}
        </AnimatePresence>

        {/* Large Countdown Overlay */}
        <AnimatePresence>
          {countdown !== null && (
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.5, opacity: 0 }}
              key={countdown}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-xs z-20 pointer-events-none"
            >
              <div className="w-24 h-24 rounded-full bg-violet-600/90 text-white flex items-center justify-center text-5xl font-black shadow-2xl border-4 border-white">
                {countdown}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* PERMISSION CHECKING & LOADING STATE */}
        {permissionStatus === 'checking' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 p-6 text-center z-20">
            <div className="relative mb-4">
              <div className="w-14 h-14 rounded-2xl bg-violet-600/20 text-violet-400 flex items-center justify-center">
                <Camera className="w-7 h-7 animate-pulse" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center text-white">
                <RefreshCw className="w-3 h-3 animate-spin" />
              </div>
            </div>
            <h3 className="text-base font-semibold text-white mb-1">
              Initializing Camera...
            </h3>
            <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
              Requesting webcam stream permissions for biometric face verification.
            </p>
          </div>
        )}

        {/* PERMISSION DENIED / ERROR STATE */}
        {permissionStatus === 'denied' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 p-6 text-center z-20">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/10 text-rose-400 flex items-center justify-center mb-3 border border-rose-500/20">
              <VideoOff className="w-7 h-7" />
            </div>

            <h3 className="text-base font-semibold text-white mb-1.5">
              {errorType === 'denied'
                ? 'Camera Access Blocked'
                : errorType === 'not-found'
                ? 'Camera Not Detected'
                : errorType === 'busy'
                ? 'Camera In Use'
                : 'Unable to Start Camera'}
            </h3>

            <p className="text-xs text-slate-300 max-w-sm mb-4 leading-relaxed">
              {errorMessage || 'Camera permissions are required for face recognition.'}
            </p>

            {/* Actionable instructions depending on error */}
            {errorType === 'denied' && (
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 text-left max-w-xs mb-4 text-[11px] text-slate-400 space-y-1">
                <div className="flex items-center gap-1.5 text-slate-200 font-medium">
                  <Lock className="w-3.5 h-3.5 text-violet-400" />
                  How to unlock camera:
                </div>
                <p>1. Click the lock or camera icon in your browser URL bar.</p>
                <p>2. Set Camera to <span className="text-emerald-400 font-semibold">Allow</span>.</p>
                <p>3. Click the button below to re-check permissions.</p>
              </div>
            )}

            <button
              id="camera-retry-button"
              onClick={() => startCamera(selectedDeviceId || undefined)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-all shadow-md active:scale-95 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Try Again / Request Permission
            </button>
          </div>
        )}

        {/* UNSUPPORTED BROWSER STATE */}
        {permissionStatus === 'unsupported' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 p-6 text-center z-20">
            <AlertCircle className="w-12 h-12 text-rose-500 mb-3" />
            <h3 className="text-base font-semibold text-white mb-1">
              Webcam Unsupported
            </h3>
            <p className="text-xs text-slate-400 max-w-xs">
              Your browser or environment does not support media device video capture.
            </p>
          </div>
        )}
      </div>

      {/* Control Bar Below Viewport */}
      <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200/80 dark:border-slate-800 flex flex-col gap-3">
        {/* Secondary options toolbar (Mirror, Device Switch, Live Metrics) */}
        {!isCaptured && permissionStatus === 'granted' && (
          <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
            <div className="flex items-center gap-2">
              {showMirrorToggle && (
                <button
                  id="camera-mirror-toggle"
                  type="button"
                  onClick={() => setIsMirrored(!isMirrored)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                    isMirrored
                      ? 'bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800/60 text-violet-700 dark:text-violet-300 font-medium'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                  title="Toggle horizontal mirror"
                >
                  <FlipHorizontal className="w-3.5 h-3.5" />
                  <span>Mirror {isMirrored ? 'On' : 'Off'}</span>
                </button>
              )}

              {showDeviceSelect && availableDevices.length > 1 && (
                <div className="relative inline-flex items-center">
                  <select
                    id="camera-device-select"
                    value={selectedDeviceId}
                    onChange={(e) => {
                      setSelectedDeviceId(e.target.value);
                      startCamera(e.target.value);
                    }}
                    className="appearance-none bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg px-2.5 py-1.5 pr-7 text-xs font-medium cursor-pointer"
                  >
                    {availableDevices.map((device, idx) => (
                      <option key={device.deviceId || idx} value={device.deviceId}>
                        {device.label || `Camera ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 pointer-events-none" />
                </div>
              )}
            </div>

            {/* Real-time head pose / yaw tag */}
            {liveBiometrics && liveBiometrics.pose && liveBiometrics.pose.pose !== 'UNKNOWN' && (
              <div className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                <span>Pose:</span>
                <span className="font-semibold text-violet-600 dark:text-violet-400">
                  {liveBiometrics.pose.pose}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Primary Action Buttons */}
        {!isCaptured ? (
          <div className="flex items-center justify-center gap-4 py-1">
            {/* 3-Second Timer button */}
            <button
              id="camera-timer-button"
              type="button"
              disabled={!isCameraReady || permissionStatus !== 'granted'}
              onClick={() => startCountdown(3)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              title="Take photo with 3-second delay"
            >
              <Sparkles className="w-3.5 h-3.5 text-violet-500" />
              <span>Timer (3s)</span>
            </button>

            {/* Main Shutter Button */}
            <button
              id="camera-shutter-button"
              type="button"
              disabled={
                !isCameraReady ||
                permissionStatus !== 'granted' ||
                (requireFaceDetected && (!hasFace || !isCentered))
              }
              onClick={takeSnapshot}
              className="group relative flex items-center justify-center w-16 h-16 rounded-full bg-violet-600 hover:bg-violet-700 text-white shadow-lg hover:shadow-violet-500/25 transition-all duration-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              aria-label="Take Snapshot"
            >
              <div className="w-12 h-12 rounded-full border-2 border-white/80 flex items-center justify-center group-hover:scale-105 transition-transform">
                <Camera className="w-6 h-6 text-white" />
              </div>
            </button>

            {/* Flip front/back camera (for mobile) */}
            <button
              id="camera-flip-facing-button"
              type="button"
              disabled={!isCameraReady || permissionStatus !== 'granted'}
              onClick={() => {
                const nextMode = facingMode === 'user' ? 'environment' : 'user';
                setFacingMode(nextMode);
                setIsMirrored(nextMode === 'user');
                startCamera();
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              title="Switch between front and back camera"
            >
              <Video className="w-3.5 h-3.5 text-slate-500" />
              <span>Switch Cam</span>
            </button>
          </div>
        ) : (
          /* Snapshot Review Mode Actions */
          <div className="flex flex-col gap-3">
            {/* Snapshot biometric telemetry review */}
            {capturedBiometrics && (
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Biometric Face Data Verified
                  </span>
                </div>
                <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                  <span>Pose: {capturedBiometrics.pose.pose}</span>
                  {capturedBiometrics.descriptor && (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      128D Ready
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              {/* Retake Button */}
              <button
                id="camera-retake-button"
                type="button"
                onClick={retakePhoto}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-all cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retake</span>
              </button>

              {/* Confirm / Use Button */}
              <button
                id="camera-confirm-button"
                type="button"
                onClick={handleConfirm}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-all shadow-md hover:shadow-emerald-500/20 active:scale-98 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>{confirmText}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CameraCapture;
