# CUDA and cuDNN are present for specialist backends that extend this image.
# The base service deliberately installs no model weights and no fake detector.
ARG CUDA_IMAGE=nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04
FROM ${CUDA_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /service
COPY requirements.txt ./requirements.txt
RUN python3 -m pip install --no-cache-dir -r requirements.txt

COPY geolens_inference ./geolens_inference

RUN useradd --create-home --uid 10001 geolens \
    && chown -R geolens:geolens /service
USER geolens

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/ready', timeout=2).read()"]

CMD ["python3", "-m", "uvicorn", "geolens_inference.main:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
