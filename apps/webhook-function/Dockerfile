FROM python:3.12-slim
WORKDIR /app
COPY webhook-function/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY otel_setup.py .
COPY webhook-function/trigger.py .
CMD ["python", "trigger.py"]
