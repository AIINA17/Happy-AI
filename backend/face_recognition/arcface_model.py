import ctypes
import glob
import importlib
import os

import cv2
import numpy as np
import onnxruntime
from insightface.app import FaceAnalysis

# cuDNN links against cuBLAS, and cuBLAS links against nvJitLink — load in
# this order so each .so's own dependencies are already resident when it's
# opened. Matches the pip packages installed for local GPU dev (see
# backend/README.md); not in requirements.txt on purpose.
_CUDA_LIB_PACKAGES = ["cuda_runtime", "nvjitlink", "curand", "cufft", "cublas", "cudnn"]


def _preload_cuda_libs() -> bool:
    """Best-effort preload of the pip nvidia-*-cu12 runtime libs so
    onnxruntime's CUDAExecutionProvider can resolve them at dlopen time.

    Setting LD_LIBRARY_PATH from within an already-running process doesn't
    work (glibc's dynamic linker only reads it once at process start), so
    this preloads each .so directly via ctypes instead. Must never raise —
    machines without these pip packages (any dev without a GPU, CI, the
    production container) should silently fall back to CPU exactly like
    before, with no dangling half-loaded state.
    """
    try:
        nvidia = importlib.import_module("nvidia")
    except ImportError:
        return False

    nvidia_dir = nvidia.__path__[0]
    loaded_any = False
    for pkg in _CUDA_LIB_PACKAGES:
        lib_dir = os.path.join(nvidia_dir, pkg, "lib")
        if not os.path.isdir(lib_dir):
            continue
        for so_path in sorted(glob.glob(os.path.join(lib_dir, "*.so*"))):
            try:
                ctypes.CDLL(so_path, mode=ctypes.RTLD_GLOBAL)
                loaded_any = True
            except OSError:
                pass

    return loaded_any


class ArcFaceModel:
    def __init__(self):
        available = onnxruntime.get_available_providers()
        use_cuda = "CUDAExecutionProvider" in available and _preload_cuda_libs()
        providers = (
            ["CUDAExecutionProvider", "CPUExecutionProvider"]
            if use_cuda
            else ["CPUExecutionProvider"]
        )

        self.app = FaceAnalysis(
            name="buffalo_l",
            providers=providers
        )

        # insightface only honors the `providers` list above when ctx_id>=0;
        # ctx_id=-1 would force CPUExecutionProvider regardless (see
        # insightface's model_zoo prepare()). det_size menentukan ukuran
        # input untuk deteksi wajah.
        ctx_id = 0 if use_cuda else -1
        self.app.prepare(ctx_id=ctx_id, det_size=(640, 640))

    def extract_embedding(self, image_bytes: bytes) -> np.ndarray:
        image_array = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

        if image is None:
            raise ValueError("Gambar tidak valid atau tidak dapat dibaca.")

        faces = self.app.get(image)

        if len(faces) == 0:
            raise ValueError("Tidak ada wajah terdeteksi pada gambar.")

        if len(faces) > 1:
            raise ValueError("Terdeteksi lebih dari satu wajah. Gunakan gambar dengan satu wajah saja.")

        embedding = faces[0].embedding.astype(np.float32)

        # Normalisasi agar cosine similarity cukup dihitung dengan dot product.
        embedding = embedding / np.linalg.norm(embedding)

        return embedding