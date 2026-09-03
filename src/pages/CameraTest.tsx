import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import CameraCapture, { CameraCaptureResult } from '../components/CameraCapture';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Camera, 
  ArrowLeft, 
  CheckCircle, 
  Sparkles, 
  Download, 
  Trash2, 
  ShieldCheck, 
  Layers, 
  Sliders, 
  Maximize2 
} from 'lucide-react';

const CameraTest: React.FC = () => {
  const navigate = useNavigate();
  const [snapshots, setSnapshots] = useState<CameraCaptureResult[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<CameraCaptureResult | null>(null);
  
  // Settings for testing
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [requireFaceCentered, setRequireFaceCentered] = useState(false);
  const [showDeviceSelector, setShowDeviceSelector] = useState(true);

  const handleCapture = (result: CameraCaptureResult) => {
    setSnapshots((prev) => [result, ...prev]);
    setSelectedSnapshot(result);
  };

  const downloadSnapshot = (result: CameraCaptureResult) => {
    const a = document.createElement('a');
    a.href = result.imageSrc;
    a.download = `face_snapshot_${new Date(result.timestamp).toISOString().replace(/[:.]/g, '-')}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <Header title="Camera & Face Recognition Test" />

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-6">
        {/* Navigation & Title */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer text-slate-600 dark:text-slate-300"
              title="Go Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                <span>Webcam Snapshot & Permission Test</span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20">
                  Live Biometrics
                </span>
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Evaluate webcam permissions, live facial bounding guide, and real-time biometric snapshot extraction.
              </p>
            </div>
          </div>

          {/* Quick Stats Pill */}
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-600 dark:text-slate-400">
            <Sparkles className="w-4 h-4 text-violet-500" />
            <span>Snapshots Taken: <strong className="text-slate-900 dark:text-white">{snapshots.length}</strong></span>
          </div>
        </div>

        {/* 2-Column Responsive Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Column 1: Live CameraCapture Component */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            <CameraCapture
              title="Camera Viewfinder"
              subtitle="Center your face inside the guide and click the shutter"
              autoAnalyze={autoAnalyze}
              requireFaceDetected={requireFaceCentered}
              showDeviceSelect={showDeviceSelector}
              onCapture={handleCapture}
            />

            {/* Test Configuration Panel */}
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col gap-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <Sliders className="w-4 h-4 text-violet-500" />
                <span>Component Options</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoAnalyze}
                    onChange={(e) => setAutoAnalyze(e.target.checked)}
                    className="rounded text-violet-600 focus:ring-violet-500"
                  />
                  <span className="text-slate-700 dark:text-slate-200 font-medium">
                    Auto-extract 128D Embedding
                  </span>
                </label>

                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requireFaceCentered}
                    onChange={(e) => setRequireFaceCentered(e.target.checked)}
                    className="rounded text-violet-600 focus:ring-violet-500"
                  />
                  <span className="text-slate-700 dark:text-slate-200 font-medium">
                    Require Centered Face
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Column 2: Snapshots Gallery & Biometric Inspection */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-sm text-slate-800 dark:text-white">
                  <Layers className="w-4 h-4 text-violet-500" />
                  <span>Captured Snapshots ({snapshots.length})</span>
                </div>
                {snapshots.length > 0 && (
                  <button
                    onClick={() => {
                      setSnapshots([]);
                      setSelectedSnapshot(null);
                    }}
                    className="text-xs text-rose-500 hover:text-rose-600 font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear All
                  </button>
                )}
              </div>

              {snapshots.length === 0 ? (
                <div className="py-12 px-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center text-slate-400">
                  <Camera className="w-10 h-10 mb-2 stroke-[1.5] text-slate-300 dark:text-slate-700" />
                  <p className="text-xs font-medium">No snapshots taken yet</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 max-w-xs">
                    Allow camera access and take a snapshot using the shutter button on the left.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {/* Selected Snapshot Preview */}
                  {selectedSnapshot && (
                    <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80">
                      <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-black flex items-center justify-center">
                        <img
                          src={selectedSnapshot.imageSrc}
                          alt="Snapshot Preview"
                          className="w-full h-full object-cover"
                        />
                        <button
                          onClick={() => downloadSnapshot(selectedSnapshot)}
                          className="absolute bottom-2 right-2 p-2 rounded-lg bg-slate-900/80 hover:bg-slate-900 text-white backdrop-blur-xs text-xs font-semibold flex items-center gap-1.5 shadow-md cursor-pointer transition-colors"
                          title="Download Snapshot"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download
                        </button>
                      </div>

                      {/* Biometric Details */}
                      <div className="flex flex-col gap-2 text-xs">
                        <div className="flex items-center justify-between font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          <span>Resolution: {selectedSnapshot.width} × {selectedSnapshot.height}</span>
                          <span>{new Date(selectedSnapshot.timestamp).toLocaleTimeString()}</span>
                        </div>

                        {selectedSnapshot.biometrics ? (
                          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5 font-bold">
                              <ShieldCheck className="w-4 h-4 text-emerald-500" />
                              <span>Face Biometrics Extracted</span>
                            </div>
                            <div className="grid grid-cols-2 gap-1 text-[11px] font-mono mt-1">
                              <div>Pose: {selectedSnapshot.biometrics.pose.pose}</div>
                              <div>
                                Centered: {selectedSnapshot.biometrics.isCentered ? 'Yes' : 'No'}
                              </div>
                              <div>
                                EAR (Eyes): {selectedSnapshot.biometrics.ear.avgEAR.toFixed(2)}
                              </div>
                              <div>
                                Faces: {selectedSnapshot.biometrics.faceCount}
                              </div>
                            </div>
                            {selectedSnapshot.descriptor && (
                              <div className="text-[10px] text-emerald-600 dark:text-emerald-400 break-all font-mono mt-1 bg-emerald-500/10 p-1.5 rounded">
                                Vector: [{selectedSnapshot.descriptor.slice(0, 4).map(n => n.toFixed(3)).join(', ')}, ... +124 more values]
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs">
                            Biometric extraction was not enabled for this capture.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Thumbnail Row */}
                  <div className="grid grid-cols-4 gap-2">
                    {snapshots.map((snap, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedSnapshot(snap)}
                        className={`relative aspect-[4/3] rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                          selectedSnapshot === snap
                            ? 'border-violet-500 scale-105 shadow-md'
                            : 'border-transparent hover:border-slate-300 dark:hover:border-slate-700 opacity-80 hover:opacity-100'
                        }`}
                      >
                        <img src={snap.imageSrc} alt={`Thumbnail ${idx}`} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default CameraTest;
