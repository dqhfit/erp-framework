"""
LLMLingua Prompt Compression Sidecar Server
───────────────────────────────────────────
Minimal Flask server nén prompt trước khi gọi LLM lớn.
Dùng LLMLingua-2 (model DistilBERT nhỏ, không cần GPU).

Chạy:
  python -m venv .venv
  .venv/Scripts/pip install llmlingua flask flask-cors
  .venv/Scripts/python server.py

Mặc định port 8908, trùng pattern Tika/Ollama sidecar.
"""

import os
import sys
import json
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Lazy-load model — chỉ load khi request đầu tiên (chờ model download)
_prompt_compressor = None


def get_compressor():
    """Lazy-init LLMLingua-2 PromptCompressor. Model chỉ load 1 lần.

    Dùng microsoft/llmlingua-2-bert-base-multilingual-c7-mb (LLMLingua-2
    official). Nặng ~700MB, nhưng xử lý đa ngôn ngữ (kể cả tiếng Việt).
    Đổi qua env LLMLINGUA_MODEL nếu muốn model khác (vd 'distilbert-base-uncased'
    cho English-only nhẹ hơn).
    """
    global _prompt_compressor
    if _prompt_compressor is None:
        from llmlingua import PromptCompressor
        # LLMLingua-2 official model (default). bert-base-multilingual nhẹ
        # (~700MB), xử lý đa ngôn ngữ (kể cả tiếng Việt) — cân bằng tốc độ/size.
        # Đổi qua env LLMLINGUA_MODEL nếu cần model khác:
        #   - microsoft/llmlingua-2-xlm-roberta-large-meetingbank (~2GB, chất
        #     lượng cao nhất, chậm hơn)
        #   - distilbert-base-uncased (~270MB, English-only, nhẹ nhất)
        model_name = os.environ.get(
            "LLMLINGUA_MODEL",
            "microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank",
        )
        use_llmlingua2 = os.environ.get("LLMLINGUA_V2", "1") == "1"
        # Ép CPU — máy dev không có CUDA, transformers auto-detect cuda sẽ throw
        # "Torch not compiled with CUDA enabled". Có GPU thì set env
        # LLMLINGUA_DEVICE=cuda (hoặc "auto").
        device_map = os.environ.get("LLMLINGUA_DEVICE", "cpu")
        _prompt_compressor = PromptCompressor(
            model_name=model_name,
            use_llmlingua2=use_llmlingua2,
            device_map=device_map,
        )
    return _prompt_compressor


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "llmlingua"})


@app.route("/compress", methods=["POST"])
def compress():
    """Nén prompt. Body JSON:
    {
        "text": "system prompt + context ...",
        "question": "câu hỏi chính (giữ nguyên)"  (optional),
        "rate": 0.5  (tỷ lệ nén, 0-1, default 0.5),
        "target_token": 4096  (hoặc chỉ định max token thay vì rate)  (optional)
    }
    """
    try:
        body = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON body"}), 400

    text = body.get("text", "")
    if not text.strip():
        return jsonify({"error": "Missing 'text' field"}), 400

    question = body.get("question", "")
    rate = body.get("rate", 0.5)
    # rate 0.0 → giữ nguyên (không nén), 1.0 → nén tối đa
    rate = max(0.0, min(1.0, rate))

    target_token = body.get("target_token")

    if rate == 0.0:
        # Không nén — trả nguyên
        return jsonify({
            "compressed": text,
            "original_length": len(text),
            "compressed_length": len(text),
            "ratio": 1.0,
        })

    try:
        compressor = get_compressor()

        kwargs = {}
        if target_token and target_token > 0:
            kwargs["target_token"] = target_token
        else:
            kwargs["rate"] = rate

        result = compressor.compress_prompt(
            text,
            question=question or None,
            **kwargs,
        )

        compressed = result.get("compressed_prompt", text)

        return jsonify({
            "compressed": compressed,
            "original_length": len(text),
            "compressed_length": len(compressed),
            "ratio": len(compressed) / len(text) if len(text) > 0 else 1.0,
        })

    except Exception as e:
        app.logger.error(f"Compression error: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("LLMLINGUA_PORT", "8908"))
    print(f"🧠 LLMLingua server chạy tại http://localhost:{port}")
    print(f"   Endpoints: POST /compress, GET /health")
    app.run(host="127.0.0.1", port=port)
