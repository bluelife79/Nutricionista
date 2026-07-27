"""Convert microservicio embeddings.npz → browser-friendly int8 binary.

Output (in assets/):
  embeddings.bin       — N × dim int8 row-major (~2 MB for 5322 × 384)
  embeddings_meta.json — { model, dim, n, scale, db_hash, generated_at, index }

Quantization: L2-normalized float32 in [-1, 1] → int8 in [-127, 127].
Cosine of two L2-normalized vectors = dot product. After quantization:
    cosine ≈ Σ(qa[i] * qb[i]) / (127 * 127)
Approximation error is small and ranking-preserving for our use case.
"""
from __future__ import annotations
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).parent.parent
NPZ_PATH   = ROOT / "microservicio" / "data" / "embeddings.npz"
META_PATH  = ROOT / "microservicio" / "data" / "meta.json"
INDEX_PATH = ROOT / "microservicio" / "data" / "index.json"

OUT_DIR = ROOT / "assets"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_BIN  = OUT_DIR / "embeddings.bin"
OUT_META = OUT_DIR / "embeddings_meta.json"


def main():
    matrix = np.load(NPZ_PATH)["matrix"].astype(np.float32)
    server_meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))

    n, dim = matrix.shape
    print(f"Loaded matrix: {n} × {dim} {matrix.dtype}")
    print(f"Range: min={matrix.min():.4f} max={matrix.max():.4f}")

    # L2-normalized vectors → values in [-1, 1]. Quantize to int8 in [-127, 127].
    # Clip defensively (some normalization may produce ~1.0001 due to fp error).
    clipped = np.clip(matrix, -1.0, 1.0)
    quantized = np.round(clipped * 127.0).astype(np.int8)

    # Write raw bytes row-major
    OUT_BIN.write_bytes(quantized.tobytes())
    bin_size = OUT_BIN.stat().st_size
    print(f"Wrote {OUT_BIN.relative_to(ROOT)}: {bin_size/1024:.1f} KB ({bin_size/1024/1024:.2f} MB)")

    # Meta with index inline (small enough to ship together)
    out_meta = {
        "model": server_meta["model"],
        "dim": dim,
        "n": n,
        "scale": 1.0 / 127.0,         # dequantize: int8 * scale → float
        "cosine_divisor": 127.0 * 127.0,  # for raw int8 dot product
        "db_hash": server_meta["db_hash"],
        "generated_at": server_meta["generated_at"],
        "index": index,
    }
    OUT_META.write_text(json.dumps(out_meta, ensure_ascii=False), encoding="utf-8")
    meta_size = OUT_META.stat().st_size
    print(f"Wrote {OUT_META.relative_to(ROOT)}: {meta_size/1024:.1f} KB")

    # Sanity: dequantize a sample, compare with original
    sample_idx = 0
    orig = matrix[sample_idx]
    deq = quantized[sample_idx].astype(np.float32) / 127.0
    err = np.abs(orig - deq).mean()
    print(f"\nSanity check (sample row 0): mean abs error after q/dq = {err:.5f}")
    cos_orig = float(np.dot(orig, matrix[1]))
    cos_quant = float(np.dot(quantized[sample_idx].astype(np.int32), quantized[1].astype(np.int32))) / (127.0 * 127.0)
    print(f"Cosine row0↔row1 — original: {cos_orig:.4f} | quantized: {cos_quant:.4f}")


if __name__ == "__main__":
    main()
