import { useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Button } from './ui/button';
import { Camera, RefreshCw, Check, SwitchCamera } from 'lucide-react';

interface CameraCaptureProps {
  onCapture: (imageSrc: string) => void;
  onCancel?: () => void;
}

export function CameraCapture({ onCapture, onCancel }: CameraCaptureProps) {
  const webcamRef = useRef<Webcam>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const capture = useCallback(() => {
    if (webcamRef.current) {
      const imageSrc = webcamRef.current.getScreenshot();
      setImageSrc(imageSrc);
    }
  }, [webcamRef]);

  const retake = () => {
    setImageSrc(null);
  };

  const confirm = () => {
    if (imageSrc) {
      onCapture(imageSrc);
    }
  };

  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  return (
    <div className="flex flex-col items-center gap-4 p-4 border rounded-xl bg-gray-50">
      <div className="relative w-full max-w-sm overflow-hidden rounded-lg shadow-inner aspect-square bg-black">
        {!imageSrc ? (
          <>
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              videoConstraints={{ facingMode: facingMode }}
              className="w-full h-full object-cover"
            />
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute bottom-3 right-3 rounded-full opacity-80 hover:opacity-100 shadow bg-white/80 hover:bg-white text-gray-800"
              onClick={toggleFacingMode}
              title="Alternar Câmera"
            >
              <SwitchCamera className="w-5 h-5" />
            </Button>
          </>
        ) : (
          <img src={imageSrc} alt="Captured" className="w-full h-full object-cover" />
        )}
      </div>

      <div className="flex gap-3 mt-2">
        {!imageSrc ? (
          <>
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancelar
              </Button>
            )}
            <Button type="button" onClick={capture} className="bg-blue-600 hover:bg-blue-700">
              <Camera className="w-4 h-4 mr-2" />
              Tirar Foto
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={retake}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Tentar Novamente
            </Button>
            <Button type="button" onClick={confirm} className="bg-green-600 hover:bg-green-700">
              <Check className="w-4 h-4 mr-2" />
              Confirmar Foto
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
