// 아이콘 초기화
lucide.createIcons();

// DOM 요소 
const apiKeyInput = document.getElementById('apiKeyInput');
const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const progressSection = document.getElementById('progressSection');
const fileList = document.getElementById('fileList');
const downloadZipBtn = document.getElementById('downloadZipBtn');

// 상태 변수
let convertedFiles = []; // { filename: '', content: '' }
let isProcessing = false;

// 1. API 키 로컬 스토리지 관리
const API_KEY_STORAGE = 'gemini_pdf_md_api_key';

window.addEventListener('DOMContentLoaded', () => {
  const savedKey = localStorage.getItem(API_KEY_STORAGE);
  if (savedKey) {
    apiKeyInput.value = savedKey;
  }
});

saveApiKeyBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (key) {
    localStorage.setItem(API_KEY_STORAGE, key);
    alert('API 키가 브라우저에 안전하게 저장되었습니다.');
  } else {
    alert('API 키를 입력해주세요.');
  }
});

function getApiKey() {
  return apiKeyInput.value.trim();
}

// 2. 드래그 앤 드롭 및 파일 업로드 처리
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');

  if (isProcessing) return alert('현재 변환이 진행 중입니다. 잠시만 기다려주세요.');
  handleFiles(e.dataTransfer.files);
});

dropZone.addEventListener('click', () => {
  if (isProcessing) return alert('현재 변환이 진행 중입니다. 잠시만 기다려주세요.');
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
});

function handleFiles(files) {
  const pdfFiles = Array.from(files).filter(file => file.type === 'application/pdf');

  if (pdfFiles.length === 0) {
    alert('PDF 파일만 업로드 가능합니다.');
    return;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    alert('Gemini API 키를 먼저 입력하고 저장해주세요.');
    return;
  }

  startProcessing(pdfFiles, apiKey);
}

// 3. 파일 변환 프로세스 시작
async function startProcessing(files, apiKey) {
  isProcessing = true;
  convertedFiles = [];
  downloadZipBtn.style.display = 'none';
  progressSection.style.display = 'block';
  fileList.innerHTML = ''; // 초기화

  // 각 파일에 대한 UI 항목 생성
  const fileItems = files.map((file, index) => {
    const id = `file-item-${index}`;
    createFileUI(id, file.name);
    return { id, file };
  });

  lucide.createIcons();

  // 순차적으로 변환 처리 (에러 방지 및 API 속도 제한 고려)
  for (const item of fileItems) {
    try {
      updateFileUI(item.id, '처리 중...', 'processing', 50);

      const base64Data = await convertFileToBase64(item.file);
      const pureBase64 = base64Data.split(',')[1]; // MIME 타입 접두어 제거

      const markdownContent = await callGeminiAPI(pureBase64, apiKey);

      // 파일명 변경 (.pdf -> .md)
      const mdFilename = item.file.name.replace(/\.[^/.]+$/, "") + ".md";
      convertedFiles.push({
        filename: mdFilename,
        content: markdownContent
      });

      updateFileUI(item.id, '변환 완료', 'success', 100);
    } catch (error) {
      console.error(error);
      updateFileUI(item.id, `오류: ${error.message}`, 'error', 100);
    }
  }

  isProcessing = false;
  lucide.createIcons(); // 업데이트된 아이콘 새로고침

  if (convertedFiles.length > 0) {
    downloadZipBtn.style.display = 'inline-flex';
  }
}

// 3.5. 사용 가능한 최적의 모델 후보군 자동 탐지
async function getAvailablePDFModels(apiKey) {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!response.ok) return [];

    const data = await response.json();
    const availableModels = (data.models || []).map(m => m.name.replace('models/', ''));

    // PDF 변환이 가능한 모델들의 우선순위 (초강력 모델부터 빠르고 가벼운 모델 순서대로)
    const PDF_CAPABLE_MODELS = [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.0-flash-exp',
      'gemini-2.0-flash',
      'gemini-1.5-pro-latest',
      'gemini-1.5-pro',
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash',
      'gemini-1.5-flash-8b'
    ];

    return PDF_CAPABLE_MODELS.filter(m => availableModels.includes(m));
  } catch (error) {
    console.warn("API 모델 목록을 부르는데 실패했습니다.", error);
    return [];
  }
}

// 4. API 호출 (PDF -> MD)
async function callGeminiAPI(base64Data, apiKey) {
  let candidateModels = await getAvailablePDFModels(apiKey);

  if (candidateModels.length === 0) {
    // API 연결 오류거나 계정에 모델이 하나도 없을 경우의 Fallback
    candidateModels = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash-8b'];
  }

  // 이전에 에러(할당량 초과 등)가 발생해 블랙리스트에 등록된 모델들 제외
  const blacklisted = JSON.parse(localStorage.getItem('gemini_blacklisted_models') || '[]');
  let runModels = candidateModels.filter(m => !blacklisted.includes(m));

  // 만약 모든 모델이 블랙리스트에 올랐다면, 블랙리스트를 초기화하고 처음부터 다시 시도
  if (runModels.length === 0) {
    localStorage.removeItem('gemini_blacklisted_models');
    runModels = candidateModels;
  }

  const prompt = `이 PDF 문서의 내용을 완벽한 마크다운(.md) 포맷으로 변환해줘. 
1. 본문의 구조(제목, 하위 목록, 들여쓰기 등)를 최대한 원본과 동일하게 직관적으로 유지할 것.
2. 원본 문서에 있는 '표(Table)'는 절대로 본문 테스트로 섞지 말고 마크다운의 표 포맷(| 컬럼 |)을 사용하여 깔끔하게 변환할 것.
3. 문서의 레이아웃을 위한 불필요한 텍스트(머리말, 꼬리말, 페이지 번호 등)는 제외할 것.
4. 어떤 인사말이나 부가 설명도 없이 오직 변환된 마크다운 텍스트 원본만 출력할 것.`;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: base64Data
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1
    }
  };

  // 가용 모델들을 순서대로 시도하는 자동 Fallback (복구) 루프
  let lastErrorMsg = '';

  for (const modelName of runModels) {
    try {
      console.log(`[시도 중]: ${modelName} 모델로 변환 요청...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errMsg = errorData.error?.message || '알 수 없는 오류';

        console.warn(`[실패]: ${modelName} - ${errMsg}`);
        lastErrorMsg = errMsg;

        // 429(할당량 초과), 403(권한 없음), 400(지원하지 않는 기능), 404(모델 없음) 일 경우 블랙리스트에 추가하고 다음 모델로 넘어감
        if ([429, 403, 400, 404].includes(response.status) || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('not found')) {
          const bl = JSON.parse(localStorage.getItem('gemini_blacklisted_models') || '[]');
          if (!bl.includes(modelName)) {
            bl.push(modelName);
            localStorage.setItem('gemini_blacklisted_models', JSON.stringify(bl));
          }
          continue; // 다음 모델 시도
        }

        // 그 외의 치명적 오류면 즉시 중단
        throw new Error(errMsg);
      }

      // 변환 성공 시
      const data = await response.json();
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // 마크다운 코드 블록(```markdown ... ```)으로 묶여 나올 경우 벗겨내기
      text = text.trim();
      if (text.startsWith('```markdown')) {
        text = text.substring(11);
      } else if (text.startsWith('```')) {
        text = text.substring(3);
      }
      if (text.endsWith('```')) {
        text = text.substring(0, text.length - 3);
      }

      console.log(`[성공]: ${modelName} 모델로 변환 완료!`);
      return text.trim();

    } catch (err) {
      console.warn(`[오류]: ${modelName} 처리 중 시스템 에러`, err);
      lastErrorMsg = err.message;
      // 네트워크 오류 등일 경우 일단 다음 모델로 시도해봄
    }
  }

  // 모든 모델이 실패한 경우
  throw new Error(`모든 AI 모델의 사용량이 초과되었거나 접근이 제한되었습니다. (최근 오류: ${lastErrorMsg})\n잠시 후 다시 시도하시거나 다른 Google API 키를 사용해보세요.`);
}

// 파일 -> Base64 변환 유틸리티
function convertFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

// 5. ZIP 압축 및 다운로드 처리
downloadZipBtn.addEventListener('click', () => {
  if (convertedFiles.length === 0) return;

  const zip = new JSZip();

  convertedFiles.forEach(file => {
    zip.file(file.filename, file.content);
  });

  zip.generateAsync({ type: "blob" }).then(function (content) {
    // 임시 링크 생성 및 클릭하여 다운로드
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);

    // 날짜를 포함한 기본 다운로드 파일명
    const today = new Date();
    const dateStr = `${today.getFullYear()}${(today.getMonth() + 1).toString().padStart(2, '0')}${today.getDate().toString().padStart(2, '0')}`;
    link.download = `마크다운_일괄변환_${dateStr}.zip`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
});

// UI 업데이트 유틸리티
function createFileUI(id, filename) {
  const html = `
    <div class="file-item" id="${id}">
      <div class="file-info">
        <span class="file-name"><i data-lucide="file"></i> ${filename}</span>
        <span class="file-status status-processing" id="${id}-status">
          <i data-lucide="loader-2" class="spinner"></i> 대기 중...
        </span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" id="${id}-bar" style="width: 0%;"></div>
      </div>
    </div>
  `;
  fileList.insertAdjacentHTML('beforeend', html);
}

function updateFileUI(id, statusText, statusType, progress) {
  const statusEl = document.getElementById(`${id}-status`);
  const barEl = document.getElementById(`${id}-bar`);

  if (statusEl) {
    statusEl.innerHTML = '';

    // 상태에 따른 텍스트 및 아이콘 변경
    if (statusType === 'processing') {
      statusEl.className = 'file-status status-processing processing-pulse';
      statusEl.innerHTML = `<i data-lucide="loader-2" class="spinner"></i> ${statusText}`;
      barEl.style.backgroundColor = 'var(--warning)';
    } else if (statusType === 'success') {
      statusEl.className = 'file-status status-success';
      statusEl.innerHTML = `<i data-lucide="check-circle"></i> ${statusText}`;
      barEl.style.backgroundColor = 'var(--success)';
    } else if (statusType === 'error') {
      statusEl.className = 'file-status status-error';
      statusEl.innerHTML = `<i data-lucide="alert-circle"></i> ${statusText}`;
      barEl.style.backgroundColor = 'var(--error)';
    }
  }

  if (barEl) {
    barEl.style.width = `${progress}%`;
  }

  lucide.createIcons();
}
