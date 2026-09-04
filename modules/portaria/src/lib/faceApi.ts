import * as faceapi from 'face-api.js';

let modelsLoaded = false;

export async function loadFaceModels() {
  if (typeof window === 'undefined') return;
  if (modelsLoaded) return;
  try {
    const MODEL_URL = '/models';
    
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]);
    
    modelsLoaded = true;
    console.log('Modelos do Face API carregados com sucesso.');
  } catch (err) {
    console.error('Erro ao carregar modelos do Face API:', err);
  }
}

export async function extractFaceDescriptor(imageElement: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement): Promise<Float32Array | null> {
  if (typeof window === 'undefined') return null;
  if (!modelsLoaded) {
    await loadFaceModels();
  }

  try {
    const detection = await faceapi.detectSingleFace(imageElement, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (detection) {
      return detection.descriptor;
    }
    return null;
  } catch (err) {
    console.error('Erro na extração facial:', err);
    return null;
  }
}

// Utilitário para calcular a distância Euclidiana (usada como fallback local)
// Menor distância = maior similaridade. O threshold típico é 0.4 a 0.6.
export function euclideanDistance(arr1: Float32Array, arr2: Float32Array): number {
  if (arr1.length !== arr2.length) throw new Error('Vetores devem ter o mesmo tamanho');
  let sum = 0;
  for (let i = 0; i < arr1.length; i++) {
    const diff = arr1[i] - arr2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// Converte URL em Base64 para HTMLImageElement
export function base64ToImage(base64Str: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = base64Str;
  });
}
