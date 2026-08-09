FROM python:3.12-slim

WORKDIR /app

# Dépendances système nécessaires au navigateur piloté par Scrapling
# (StealthyFetcher/DynamicFetcher sont basés sur Playwright/Camoufox).
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates fonts-liberation libnss3 libatk-bridge2.0-0 \
    libgtk-3-0 libgbm1 libasound2 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && scrapling install

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
