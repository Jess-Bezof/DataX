# DataX Google ADK agent for Cloud Run
# https://adk.dev/deploy/cloud-run/
FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN adduser --disabled-password --gecos "" adkuser \
    && chown -R adkuser:adkuser /app

COPY main.py .
COPY datax_adk/ ./datax_adk/

USER adkuser

ENV PATH="/home/adkuser/.local/bin:${PATH}"

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
