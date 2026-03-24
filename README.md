# Live Transcription Translator

<p align="center">
  <strong>Extensão Chrome que traduz em tempo real áudio em inglês para português brasileiro — microfone, áudio do sistema e legendas de chamadas.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome_Extension-MV3-4285F4?logo=googlechrome&logoColor=white" alt="Chrome MV3">
  <img src="https://img.shields.io/badge/OpenAI-Whisper_+_GPT--4o-412991?logo=openai&logoColor=white" alt="OpenAI">
  <img src="https://img.shields.io/badge/Anthropic-Claude_Haiku-6B4FBB?logo=anthropic&logoColor=white" alt="Claude">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
</p>

---

## O que é

Extensão Chrome para tradução simultânea EN → PT-BR em tempo real. Ideal para aulas, reuniões e qualquer contexto onde o áudio esteja em inglês e você precise entender em português.

### Fontes de áudio suportadas

| Fonte | Tecnologia | Latência |
|-------|-----------|---------|
| **Microfone (Whisper)** | `getUserMedia` + OpenAI Whisper | ~3-4 s |
| **Microfone (fallback)** | Web Speech API | ~1-2 s |
| **Áudio do sistema** | `getDisplayMedia` + OpenAI Whisper | ~5-6 s |
| **Legendas automáticas** | `MutationObserver` em `aria-live` | ~350 ms |

### Plataformas de captura de legendas

- Google Meet
- Microsoft Teams
- Zoom (web)
- Qualquer página com `localhost`

---

## Funcionalidades

- **Multi-provider de tradução** — Claude Haiku → GPT-4o-mini → MyMemory (cascata automática)
- **Transcrição com Whisper** — Muito mais precisa que o Web Speech API nativo
- **Áudio do sistema** — Captura o que você ouve no fone (chamadas, vídeos)
- **App de tradução completo** — Página `test.html` com histórico, timestamps e indicador de provider
- **Painel flutuante** — Overlay injetado nas páginas de videochamada
- **Janela separada** — `output.html` com histórico em janela popup independente
- **Badge de provider** — Vê em tempo real se a tradução usou Claude, OpenAI ou MyMemory

---

## Instalação

### 1. Baixar o repositório

```bash
git clone https://github.com/marcus1356/live-transcription.git
```

### 2. Carregar no Chrome

1. Abra `chrome://extensions`
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação**
4. Selecione a pasta `live-transcription`

### 3. Configurar API Keys

Clique no ícone da extensão na barra do Chrome:

- **Anthropic API Key** — `sk-ant-...` → tradução via Claude Haiku
- **OpenAI API Key** — `sk-...` → transcrição via Whisper + tradução via GPT-4o-mini

> Pelo menos uma das duas é necessária. Sem nenhuma, o sistema usa o MyMemory (gratuito, sem chave).

---

## Como usar

### App Tradutor (recomendado)

1. Clique no ícone da extensão → **Abrir App Tradutor**
2. Escolha a fonte de áudio:
   - **Microfone** — fale em inglês, veja a tradução
   - **Áudio do Sistema** — compartilhe a tela + "Compartilhar áudio do sistema"
   - **Exemplos** — teste sem microfone com frases pré-definidas

### Painel flutuante (em reuniões)

A extensão injeta automaticamente um painel no canto inferior direito quando você entra em:
- `meet.google.com`
- `teams.microsoft.com`
- `zoom.us`

Ative as legendas na plataforma → as traduções aparecem automaticamente no painel.

---

## Arquitetura

```
live-transcription/
├── manifest.json          # Chrome Extension MV3 — permissões e configuração
├── background.js          # Service worker — tradução (Claude/OpenAI/MyMemory) + Whisper
├── content.js             # Injeta painel nas páginas de videochamada
├── overlay.css            # Estilos do painel flutuante
├── test.html              # App de tradução full-page (interface principal)
├── output.html            # Janela de histórico independente
└── popup/
    ├── popup.html         # Interface do popup da extensão
    ├── popup.css          # Estilos do popup
    └── popup.js           # Lógica: salva API keys, abre janelas
```

### Fluxo de tradução

```
[Áudio] → [Captura] → [Transcrição] → [Tradução] → [Exibição]

Microfone       getUserMedia      Whisper API        Claude Haiku      App / Painel
Sistema         getDisplayMedia   (OpenAI)           GPT-4o-mini
Legendas DOM    MutationObserver  (já texto)         MyMemory (free)
```

### Cascata de providers

```
1. Claude Haiku       (se chave Anthropic configurada)
         ↓ falha
2. GPT-4o-mini        (se chave OpenAI configurada)
         ↓ falha
3. MyMemory API       (gratuito, sem chave)
```

---

## Configuração avançada

### Áudio do sistema (Windows)

1. Clique em **Áudio do Sistema**
2. Na janela de compartilhamento do Chrome, selecione a tela/aba
3. Marque o checkbox **"Compartilhar áudio do sistema"** (parte inferior da janela)
4. Clique em **Compartilhar**

O áudio é capturado em chunks de 5 segundos e enviado ao Whisper.

### Latência do microfone

- **Com OpenAI key**: usa Whisper (chunks de 3s) — maior precisão, ~3-4s de latência
- **Sem OpenAI key**: usa Web Speech API — resposta em tempo real, menor precisão

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Extensão | Chrome MV3, Manifest V3 |
| Transcrição | OpenAI Whisper (`whisper-1`) |
| Tradução | Claude Haiku (`claude-haiku-4-5`) / GPT-4o-mini / MyMemory |
| Captura de áudio | Web Speech API, getUserMedia, getDisplayMedia |
| Detecção de legendas | MutationObserver, `aria-live` |
| Armazenamento | `chrome.storage.sync` (API keys) + `chrome.storage.local` (traduções) |

---

## Licença

MIT — use livremente para fins pessoais e comerciais.
