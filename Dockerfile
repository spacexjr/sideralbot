# Imagem base com Node.js 18
FROM node:18

# Atualiza e instala dependências necessárias para Puppeteer e compilar C++
RUN apt-get update && apt-get install -y \
    g++ \
    make \
    cmake \
    libx11-dev \
    libxss1 \
    libasound2 \
    libnss3 \
    libatk-bridge2.0-0 \
    libxshmfence-dev \
    libgtk-3-0 \
    libgbm-dev \
    wget \
    ca-certificates \
    fonts-liberation \
    --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Cria diretório de trabalho
WORKDIR /app

# Copia arquivos do projeto para dentro do container
COPY . .

# Instala as dependências
RUN npm install

# Expõe a porta (se seu bot não usa webserver, pode remover)
EXPOSE 3000

# Comando de inicialização
CMD ["npm", "start"]
