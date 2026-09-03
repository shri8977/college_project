import * as faceapi from 'face-api.js';

let modelsLoaded = false;
let modelLoadingPromise: Promise<void> | null = null;
let modelLoadingError: string | null = null;

/**
 * Loads the face-api.js neural network models from /models if not already loaded.
 */
export async function loadFaceApiModels(modelsUri: string = '/models'): Promise<void> {
  if (modelsLoaded) return;
  if (modelLoadingPromise) return modelLoadingPromise;

  modelLoadingPromise = (async () => {
    console.log('[face-api.js] Loading face detection models...');
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(modelsUri),
        faceapi.nets.faceLandmark68Net.loadFromUri(modelsUri),
        faceapi.nets.faceRecognitionNet.loadFromUri(modelsUri),
      ]);

      // Optional helper models (load in background if present)
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(modelsUri).catch(() => {});
      faceapi.nets.ssdMobilenetv1.loadFromUri(modelsUri).catch(() => {});

      modelsLoaded = true;
      modelLoadingError = null;
      console.log('[face-api.js] Face detection models loaded successfully.');
    } catch (err: any) {
      console.error('[face-api.js] Error loading models from ' + modelsUri + ':', err);
      // Fallback: try relative path './models'
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri('./models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('./models'),
          faceapi.nets.faceRecognitionNet.loadFromUri('./models'),
        ]);
        faceapi.nets.faceLandmark68TinyNet.loadFromUri('./models').catch(() => {});
        faceapi.nets.ssdMobilenetv1.loadFromUri('./models').catch(() => {});

        modelsLoaded = true;
        modelLoadingError = null;
        console.log('[face-api.js] Face detection models loaded successfully from fallback ./models.');
      } catch (fallbackErr: any) {
        modelLoadingError = fallbackErr?.message || 'Failed to load face detection neural network models';
        console.error('[face-api.js] ERROR: Face landmark and detection models failed to load:', fallbackErr);
        throw fallbackErr;
      }
    }
  })();

  return modelLoadingPromise;
}

export function isFaceApiLoaded(): boolean {
  return (
    modelsLoaded &&
    faceapi.nets.tinyFaceDetector.isLoaded &&
    faceapi.nets.faceLandmark68Net.isLoaded
  );
}

export function getModelLoadingError(): string | null {
  return modelLoadingError;
}

/**
 * Helper to calculate Euclidean distance between two 2D points.
 */
function ptDist(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

/**
 * Calculates Eye Aspect Ratio (EAR) from 68 facial landmarks.
 * Right eye: landmarks 36 to 41
 * Left eye: landmarks 42 to 47
 * EAR = (||p2 - p6|| + ||p3 - p5||) / (2 * ||p1 - p4||)
 */
export function calculateEAR(pts: Array<{ x: number; y: number }>): {
  leftEAR: number;
  rightEAR: number;
  avgEAR: number;
} {
  if (!pts || pts.length < 68) {
    return { leftEAR: 0.3, rightEAR: 0.3, avgEAR: 0.3 };
  }

  // Right eye landmarks (36..41)
  const p36 = pts[36], p37 = pts[37], p38 = pts[38], p39 = pts[39], p40 = pts[40], p41 = pts[41];
  const rightWidth = ptDist(p36, p39);
  const rightEAR = rightWidth > 0 ? (ptDist(p37, p41) + ptDist(p38, p40)) / (2 * rightWidth) : 0.3;

  // Left eye landmarks (42..47)
  const p42 = pts[42], p43 = pts[43], p44 = pts[44], p45 = pts[45], p46 = pts[46], p47 = pts[47];
  const leftWidth = ptDist(p42, p45);
  const leftEAR = leftWidth > 0 ? (ptDist(p43, p47) + ptDist(p44, p46)) / (2 * leftWidth) : 0.3;

  const avgEAR = (leftEAR + rightEAR) / 2;
  return { leftEAR, rightEAR, avgEAR };
}

export const POSE_THRESHOLDS = {
  STRAIGHT_MAX: 0.08, // |yaw| <= 0.08 is considered STRAIGHT
  LEFT_MIN: -0.10,    // Yaw <= -0.10 is physically turned LEFT
  RIGHT_MIN: 0.10,    // Yaw >= +0.10 is physically turned RIGHT
};

export type PoseType = 'STRAIGHT' | 'LEFT' | 'RIGHT' | 'UNKNOWN';

export interface HeadPose {
  physicalYaw: number | null; // Negative = physically turned LEFT, Positive = physically turned RIGHT, null if unknown
  pose: PoseType;            // 'STRAIGHT' | 'LEFT' | 'RIGHT' | 'UNKNOWN'
  isStraight: boolean;
  isPhysicalTurnLeft: boolean;
  isPhysicalTurnRight: boolean;
  normalizedNoseOffset: number;
}

/**
 * Classifies head pose into STRAIGHT, LEFT, RIGHT, or UNKNOWN based on physicalYaw.
 */
export function classifyHeadPose(physicalYaw: number | null): {
  pose: PoseType;
  isStraight: boolean;
  isPhysicalTurnLeft: boolean;
  isPhysicalTurnRight: boolean;
} {
  if (physicalYaw === null || isNaN(physicalYaw)) {
    return {
      pose: 'UNKNOWN',
      isStraight: false,
      isPhysicalTurnLeft: false,
      isPhysicalTurnRight: false,
    };
  }

  let pose: PoseType = 'UNKNOWN';
  if (physicalYaw <= POSE_THRESHOLDS.LEFT_MIN) {
    pose = 'LEFT';
  } else if (physicalYaw >= POSE_THRESHOLDS.RIGHT_MIN) {
    pose = 'RIGHT';
  } else if (Math.abs(physicalYaw) <= POSE_THRESHOLDS.STRAIGHT_MAX) {
    pose = 'STRAIGHT';
  }

  return {
    pose,
    isStraight: pose === 'STRAIGHT',
    isPhysicalTurnLeft: pose === 'LEFT',
    isPhysicalTurnRight: pose === 'RIGHT',
  };
}

/**
 * Accurately estimates horizontal head turn (Physical Left vs Physical Right)
 * using 68 facial landmarks.
 * In a standard camera sensor coordinates:
 * - User's Right Eye is at pts[36..41] (left side of camera sensor X)
 * - User's Left Eye is at pts[42..47] (right side of camera sensor X)
 * - Nose tip is at pts[30]
 * - User's Right Jaw is at pts[0] (left side of camera sensor X)
 * - User's Left Jaw is at pts[16] (right side of camera sensor X)
 * 
 * When user turns head to their physical LEFT:
 * Nose moves towards user's left shoulder (towards right side of sensor / pts[42..47] & pts[16]).
 * Nose tip X shifts right relative to eye midpoint, distance to right jaw increases, distance to left jaw decreases.
 * Yields negative physicalYaw (below POSE_THRESHOLDS.LEFT_MIN, e.g. -0.12 to -0.45).
 * 
 * When user turns head to their physical RIGHT:
 * Nose moves towards user's right shoulder (towards left side of sensor / pts[36..41] & pts[0]).
 * Nose tip X shifts left relative to eye midpoint, distance to left jaw increases, distance to right jaw decreases.
 * Yields positive physicalYaw (above POSE_THRESHOLDS.RIGHT_MIN, e.g. +0.12 to +0.45).
 */
export function calculateHeadPose(
  pts: Array<{ x: number; y: number }>
): HeadPose {
  if (!pts || pts.length < 68) {
    return {
      physicalYaw: null,
      pose: 'UNKNOWN',
      isStraight: false,
      isPhysicalTurnLeft: false,
      isPhysicalTurnRight: false,
      normalizedNoseOffset: 0,
    };
  }

  // 1. Nose tip landmark (point 30)
  const noseTip = pts[30];

  // 2. Eye region centers (Right eye: 36..41, Left eye: 42..47 in sensor space)
  const rightEyeCenterX = (pts[36].x + pts[39].x) / 2;
  const leftEyeCenterX = (pts[42].x + pts[45].x) / 2;
  const eyeMidpointX = (rightEyeCenterX + leftEyeCenterX) / 2;
  const interOcularDist = Math.max(1, leftEyeCenterX - rightEyeCenterX);

  // 3. Jaw landmarks for normalization (0: user right jaw on sensor left, 16: user left jaw on sensor right)
  const rightJawX = pts[0].x;
  const leftJawX = pts[16].x;
  const distToLeftJaw = Math.max(1, leftJawX - noseTip.x);
  const distToRightJaw = Math.max(1, noseTip.x - rightJawX);

  // Normalized horizontal nose shift from eye midpoint (positive when nose moves toward sensor right)
  const rawNoseShift = (noseTip.x - eyeMidpointX) / interOcularDist;

  // Jaw asymmetry: positive when nose is closer to left jaw (sensor right), negative when closer to right jaw
  const jawAsymmetry = (distToRightJaw - distToLeftJaw) / (distToRightJaw + distToLeftJaw);

  // Physical Yaw: Inverted sensor shift so that:
  // - Turning head LEFT -> negative physicalYaw
  // - Turning head RIGHT -> positive physicalYaw
  // - Looking STRAIGHT -> approximately 0.00
  const physicalYaw = parseFloat((-0.75 * rawNoseShift - 0.25 * jawAsymmetry).toFixed(3));

  const classification = classifyHeadPose(physicalYaw);

  return {
    physicalYaw,
    pose: classification.pose,
    isStraight: classification.isStraight,
    isPhysicalTurnLeft: classification.isPhysicalTurnLeft,
    isPhysicalTurnRight: classification.isPhysicalTurnRight,
    normalizedNoseOffset: rawNoseShift,
  };
}

export interface LiveBiometricsResult {
  detection: faceapi.FaceDetection;
  landmarks: faceapi.FaceLandmarks68;
  hasLandmarks: boolean;
  descriptor?: number[];
  ear: { leftEAR: number; rightEAR: number; avgEAR: number };
  pose: HeadPose;
  box: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number; normX: number; normY: number };
  isCentered: boolean;
  faceCount: number;
}

export interface DetectOptions {
  extractDescriptor?: boolean; // Defaults to true if omitted
  inputSize?: number;          // Defaults to 320 (divisible by 32)
  scoreThreshold?: number;     // Defaults to 0.15
}

/**
 * Detects a single face in a video/canvas/image element and extracts
 * 68 facial landmarks, head pose (yaw), EAR, and optionally the 128D biometric descriptor.
 */
export async function detectFaceBiometrics(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
  detectOpts?: DetectOptions
): Promise<LiveBiometricsResult | null> {
  if (!input) return null;

  try {
    // 1. Validate element dimensions and readyState before calling face-api.js
    if (typeof HTMLVideoElement !== 'undefined' && input instanceof HTMLVideoElement) {
      if (input.readyState < 2 || !input.videoWidth || !input.videoHeight || input.videoWidth <= 0 || input.videoHeight <= 0) {
        return null;
      }
    } else if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement) {
      if (!input.width || !input.height || input.width <= 0 || input.height <= 0) {
        return null;
      }
    } else if (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement) {
      if (!input.complete || !input.naturalWidth || !input.naturalHeight || input.naturalWidth <= 0 || input.naturalHeight <= 0) {
        return null;
      }
    }

    await loadFaceApiModels();

    const inputSize = detectOpts?.inputSize || 320;
    const scoreThreshold = detectOpts?.scoreThreshold || 0.15;
    const shouldExtractDescriptor = detectOpts?.extractDescriptor !== false; // Default true

    // Multi-tier detection for high reliability across various cameras and lightings
    const primaryOptions = new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold });
    
    let detectionResult: any = null;
    let allDetectionsCount = 0;

    if (shouldExtractDescriptor) {
      // Full pipeline: detection + landmarks + 128D descriptor
      const allResults = await faceapi
        .detectAllFaces(input, primaryOptions)
        .withFaceLandmarks()
        .withFaceDescriptors();

      allDetectionsCount = allResults.length;
      if (allResults.length > 0) {
        detectionResult = allResults[0];
      } else {
        // Fallback with slightly higher inputSize and lower threshold
        const fallbackOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.10 });
        const fallbackResults = await faceapi
          .detectAllFaces(input, fallbackOptions)
          .withFaceLandmarks()
          .withFaceDescriptors();
        
        allDetectionsCount = fallbackResults.length;
        if (fallbackResults.length > 0) {
          detectionResult = fallbackResults[0];
        }
      }
    } else {
      // Fast tracking pipeline: detection + 68 landmarks (no heavy descriptor ResNet inference)
      const allResults = await faceapi
        .detectAllFaces(input, primaryOptions)
        .withFaceLandmarks();

      allDetectionsCount = allResults.length;
      if (allResults.length > 0) {
        detectionResult = allResults[0];
      } else {
        // Fallback for fast tracking
        const fallbackOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.10 });
        const fallbackResults = await faceapi
          .detectAllFaces(input, fallbackOptions)
          .withFaceLandmarks();

        allDetectionsCount = fallbackResults.length;
        if (fallbackResults.length > 0) {
          detectionResult = fallbackResults[0];
        }
      }
    }

    if (!detectionResult || !detectionResult.detection) {
      return null;
    }

    const landmarks = detectionResult.landmarks;
    const hasLandmarks = Boolean(landmarks && landmarks.positions && landmarks.positions.length >= 68);
    const points = hasLandmarks ? landmarks.positions : [];

    const ear = hasLandmarks ? calculateEAR(points) : { leftEAR: 0.3, rightEAR: 0.3, avgEAR: 0.3 };
    const pose = hasLandmarks
      ? calculateHeadPose(points)
      : {
          physicalYaw: null,
          pose: 'UNKNOWN' as PoseType,
          isStraight: false,
          isPhysicalTurnLeft: false,
          isPhysicalTurnRight: false,
          normalizedNoseOffset: 0,
        };

    const descriptor = detectionResult.descriptor ? Array.from(detectionResult.descriptor as Float32Array) : undefined;

    const b = detectionResult.detection.box;
    const box = {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    };

    const inputW = (input as HTMLVideoElement).videoWidth || (input as HTMLCanvasElement).width || 640;
    const inputH = (input as HTMLVideoElement).videoHeight || (input as HTMLCanvasElement).height || 480;

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const normX = inputW > 0 ? centerX / inputW : 0.5;
    const normY = inputH > 0 ? centerY / inputH : 0.5;

    // Generous center tolerance: 12% to 88% horizontally and vertically
    const isCentered = normX >= 0.12 && normX <= 0.88 && normY >= 0.10 && normY <= 0.90;

    return {
      detection: detectionResult.detection,
      landmarks: detectionResult.landmarks,
      hasLandmarks,
      descriptor,
      ear,
      pose,
      box,
      center: { x: centerX, y: centerY, normX, normY },
      isCentered,
      faceCount: allDetectionsCount,
    };
  } catch (err: any) {
    console.warn("[detectFaceBiometrics] Safe detection catch:", err?.message || err);
    return null;
  }
}

/**
 * Compares two 128-dimensional biometric face embeddings using Cosine Similarity.
 * Returns a score between -1 and 1, where > 0.85 indicates a strong facial match.
 */
export function calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Calculates the Euclidean distance between two 128-dimensional face descriptor vectors.
 * A distance closer to 0 indicates a higher biometric match.
 * Standard face-api.js matching threshold is ~0.45 - 0.50.
 */
export function calculateEuclideanDistance(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
    return 999;
  }

  let sum = 0;
  for (let i = 0; i < vecA.length; i++) {
    const diff = vecA[i] - vecB[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Formats a time string into 12-hour AM/PM format.
 */
export function formatTime12hr(time24?: string): string {
  if (!time24) return '--:--';
  const parts = time24.split(':');
  if (parts.length < 2) return time24;

  let hours = parseInt(parts[0]);
  const minutes = parts[1];
  const ampm = hours >= 12 ? 'PM' : 'AM';

  hours = hours % 12;
  hours = hours ? hours : 12;

  return `${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
}

/**
 * Returns the current date in YYYY-MM-DD format based on local timezone.
 */
export function getLocalDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns current local time in HH:MM format (24-hour).
 */
export function getLocalTimeString(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

