(function () {
  // Prevent multiple initializations
  if (window.__ReadyAimGoFeedbackWidgetInitialized) return;
  window.__ReadyAimGoFeedbackWidgetInitialized = true;

  // 1. Get configurations from the script tag
  const scriptTag = document.currentScript || (function() {
    const scripts = document.getElementsByTagName('script');
    for (let i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].src.indexOf('widget.js') !== -1) return scripts[i];
    }
    return null;
  })();

  const projectId = scriptTag ? scriptTag.getAttribute('data-project-id') : 'cnjCarcEEB1FaLTyQzDJ';
  const apiBaseUrl = scriptTag ? scriptTag.getAttribute('data-api-url') : 'https://clients.readyaimgo.biz';
  const storageBucket = 'readyaimgo-ab187.firebasestorage.app';

  // 2. Inject Styles
  const style = document.createElement('style');
  style.textContent = `
    .rag-widget-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .rag-widget-trigger {
      display: flex;
      align-items: center;
      gap: 8px;
      background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%);
      color: #ffffff;
      border: none;
      padding: 11px 18px;
      border-radius: 9999px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);
      transition: all 0.2s ease-in-out;
    }
    .rag-widget-trigger:hover {
      transform: translateY(-2px) scale(1.03);
      box-shadow: 0 6px 20px rgba(79, 70, 229, 0.5);
    }
    .rag-widget-modal {
      display: none;
      width: 320px;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      border: 1px solid #e2e8f0;
      padding: 16px;
      margin-bottom: 12px;
      flex-direction: column;
      animation: rag-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .rag-widget-modal.open {
      display: flex;
    }
    @keyframes rag-fade-in {
      from { opacity: 0; transform: translateY(10px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .rag-widget-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #edf2f7;
      padding-bottom: 10px;
      margin-bottom: 12px;
    }
    .rag-widget-title {
      font-size: 13px;
      font-weight: 700;
      color: #1a202c;
    }
    .rag-widget-close {
      background: none;
      border: none;
      color: #a0aec0;
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
    }
    .rag-widget-close:hover {
      color: #4a5568;
    }
    .rag-widget-group {
      margin-bottom: 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .rag-widget-label {
      font-size: 11px;
      font-weight: 600;
      color: #4a5568;
    }
    .rag-widget-input, .rag-widget-textarea {
      width: 100%;
      border: 1px solid #cbd5e0;
      border-radius: 8px;
      padding: 7px 10px;
      font-size: 12px;
      box-sizing: border-box;
      background: #ffffff;
      color: #1a202c;
    }
    .rag-widget-input:focus, .rag-widget-textarea:focus {
      outline: none;
      border-color: #4f46e5;
      box-shadow: 0 0 0 1px #4f46e5;
    }
    .rag-widget-textarea {
      min-height: 70px;
      resize: vertical;
    }
    .rag-widget-capture-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border: 1px dashed #cbd5e0;
      background: #faf5ff;
      border-radius: 8px;
      padding: 10px;
      font-size: 12px;
      font-weight: 500;
      color: #4f46e5;
      cursor: pointer;
      width: 100%;
      transition: background 0.15s ease;
      box-sizing: border-box;
    }
    .rag-widget-capture-btn:hover {
      background: #f3e8ff;
    }
    .rag-widget-thumbnail-container {
      position: relative;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      overflow: hidden;
      max-height: 120px;
      background: #f7fafc;
    }
    .rag-widget-thumbnail {
      width: 100%;
      height: 100%;
      object-fit: contain;
      max-height: 120px;
    }
    .rag-widget-thumbnail-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .rag-widget-thumbnail-container:hover .rag-widget-thumbnail-overlay {
      opacity: 1;
    }
    .rag-widget-btn-icon {
      background: #ffffff;
      border: none;
      border-radius: 50%;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #2d3748;
      box-shadow: 0 2px 5px rgba(0,0,0,0.15);
    }
    .rag-widget-btn-icon:hover {
      background: #f7fafc;
    }
    .rag-widget-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      border-top: 1px solid #edf2f7;
      padding-top: 10px;
      margin-top: 10px;
    }
    .rag-widget-submit {
      background: #4f46e5;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 7px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .rag-widget-submit:hover {
      background: #4338ca;
    }
    .rag-widget-submit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .rag-widget-error {
      background: #fff5f5;
      border: 1px solid #fed7d7;
      color: #c53030;
      padding: 8px;
      border-radius: 8px;
      font-size: 11px;
      margin-bottom: 8px;
      line-height: 1.4;
    }
    .rag-widget-success {
      text-align: center;
      padding: 16px 8px;
    }
    .rag-widget-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      margin: 2px;
    }
    .rag-widget-badge-category {
      background: #e0e7ff;
      color: #3730a3;
    }
    .rag-widget-badge-urgency {
      background: #fef3c7;
      color: #92400e;
    }

    /* Cropper Overlay styles */
    .rag-cropper-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      z-index: 2147483647;
      display: none;
      flex-direction: column;
    }
    .rag-cropper-overlay.open {
      display: flex;
    }
    .rag-cropper-header {
      background: #111827;
      padding: 14px 20px;
      color: #ffffff;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-sizing: border-box;
      border-bottom: 1px solid #374151;
    }
    .rag-cropper-container {
      flex: 1;
      overflow: auto;
      background: #1f2937;
      display: flex;
      align-items: flex-start;
      justify-content: center;
    }
    .rag-cropper-canvas-container {
      position: relative;
      cursor: crosshair;
      margin: 24px;
      user-select: none;
      -webkit-user-select: none;
    }
    .rag-cropper-btn-group {
      display: flex;
      gap: 10px;
    }
    .rag-cropper-btn {
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: background 0.15s ease;
    }
    .rag-cropper-btn-cancel {
      background: #4b5563;
      color: #ffffff;
    }
    .rag-cropper-btn-cancel:hover {
      background: #374151;
    }
    .rag-cropper-btn-confirm {
      background: #4f46e5;
      color: #ffffff;
    }
    .rag-cropper-btn-confirm:hover {
      background: #4338ca;
    }
    .rag-cropper-btn-confirm:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;
  document.head.appendChild(style);

  // 3. Create DOM layout
  const container = document.createElement('div');
  container.className = 'rag-widget-container';
  container.innerHTML = `
    <div class="rag-widget-modal" id="rag-modal">
      <div class="rag-widget-header">
        <span class="rag-widget-title">Submit Feedback</span>
        <button class="rag-widget-close" id="rag-close-btn">&times;</button>
      </div>
      <div id="rag-error-box" class="rag-widget-error" style="display: none;"></div>
      <div id="rag-form-body">
        <div class="rag-widget-group">
          <label class="rag-widget-label">Name</label>
          <input type="text" id="rag-name" placeholder="Jane Smith" class="rag-widget-input" />
        </div>
        <div class="rag-widget-group">
          <label class="rag-widget-label">Email</label>
          <input type="email" id="rag-email" placeholder="jane@example.com" class="rag-widget-input" />
        </div>
        <div class="rag-widget-group">
          <label class="rag-widget-label">Feedback</label>
          <textarea id="rag-text" placeholder="Describe the issue or observation..." class="rag-widget-textarea"></textarea>
        </div>
        <div class="rag-widget-group" id="rag-capture-area">
          <button type="button" class="rag-widget-capture-btn" id="rag-capture-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-camera"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
            Snapshot Current View
          </button>
        </div>
        <div class="rag-widget-group" id="rag-preview-area" style="display: none;">
          <div class="rag-widget-thumbnail-container">
            <img id="rag-preview-img" class="rag-widget-thumbnail" src="" alt="Capture preview" />
            <div class="rag-widget-thumbnail-overlay">
              <button type="button" class="rag-widget-btn-icon" id="rag-retake-btn" title="Retake snapshot">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-refresh-cw"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
              </button>
              <button type="button" class="rag-widget-btn-icon" id="rag-remove-btn" title="Remove screenshot">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
          </div>
        </div>
        <div class="rag-widget-actions">
          <button class="rag-widget-submit" id="rag-submit-btn">Send Feedback</button>
        </div>
      </div>
      <div id="rag-success-body" class="rag-widget-success" style="display: none;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto 12px; display: block;" class="lucide lucide-check-circle-2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
        <h4 style="margin: 0 0 4px; font-size: 14px; color: #111827; font-weight: 700;">Feedback Saved!</h4>
        <p style="margin: 0 0 12px; font-size: 11px; color: #6b7280;">Routed to the engineering pipeline.</p>
        <div id="rag-interpretation" style="display: none; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; text-align: left; font-size: 11px; margin-bottom: 12px;">
          <p style="margin: 0 0 4px; font-weight: 700; color: #374151;">AI Interpretation:</p>
          <p id="rag-success-summary" style="margin: 0 0 8px; color: #4b5563; line-height: 1.4;"></p>
          <div id="rag-badges"></div>
        </div>
        <button class="rag-widget-submit" id="rag-reset-btn" style="width: 100%;">Leave More Feedback</button>
      </div>
    </div>
    
    <!-- Cropper Overlay Markup -->
    <div class="rag-cropper-overlay" id="rag-cropper-overlay">
      <div class="rag-cropper-header">
        <span style="font-size: 13px; font-weight: 600;">Drag a box over the snapshot to crop/focus on the issue</span>
        <div class="rag-cropper-btn-group">
          <button class="rag-cropper-btn rag-cropper-btn-cancel" id="rag-crop-cancel">Skip / Keep Full</button>
          <button class="rag-cropper-btn rag-cropper-btn-confirm" id="rag-crop-confirm" disabled>Confirm Crop</button>
        </div>
      </div>
      <div class="rag-cropper-container">
        <div class="rag-cropper-canvas-container" id="rag-cropper-canvas-container">
          <canvas id="rag-cropper-canvas" style="max-width: 100%; display: block;"></canvas>
        </div>
      </div>
    </div>

    <button class="rag-widget-trigger" id="rag-trigger">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-camera"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
      Feedback
    </button>
  `;
  document.body.appendChild(container);

  // 4. Element references
  const modal = document.getElementById('rag-modal');
  const trigger = document.getElementById('rag-trigger');
  const closeBtn = document.getElementById('rag-close-btn');
  const captureBtn = document.getElementById('rag-capture-btn');
  const retakeBtn = document.getElementById('rag-retake-btn');
  const removeBtn = document.getElementById('rag-remove-btn');
  const submitBtn = document.getElementById('rag-submit-btn');
  const resetBtn = document.getElementById('rag-reset-btn');
  const errorBox = document.getElementById('rag-error-box');
  const formBody = document.getElementById('rag-form-body');
  const successBody = document.getElementById('rag-success-body');

  const nameInput = document.getElementById('rag-name');
  const emailInput = document.getElementById('rag-email');
  const textInput = document.getElementById('rag-text');
  const captureArea = document.getElementById('rag-capture-area');
  const previewArea = document.getElementById('rag-preview-area');
  const previewImg = document.getElementById('rag-preview-img');

  const interpretationArea = document.getElementById('rag-interpretation');
  const successSummary = document.getElementById('rag-success-summary');
  const badgesArea = document.getElementById('rag-badges');

  // Cropper elements
  const cropperOverlay = document.getElementById('rag-cropper-overlay');
  const cropCancel = document.getElementById('rag-crop-cancel');
  const cropConfirm = document.getElementById('rag-crop-confirm');
  const cropperCanvasContainer = document.getElementById('rag-cropper-canvas-container');
  const cropperCanvas = document.getElementById('rag-cropper-canvas');

  let currentScreenshot = null; // Base64 PNG dataUrl
  let isCapturing = false;

  // Cropper logic variables
  let originalCanvas = null;
  let cropStart = null;
  let cropEnd = null;
  let isDrawing = false;

  // 5. Setup Action Listeners
  trigger.addEventListener('click', () => {
    modal.classList.toggle('open');
  });

  closeBtn.addEventListener('click', () => {
    modal.classList.remove('open');
  });

  // Load html2canvas from CDN dynamically on-demand
  function loadHtml2Canvas() {
    return new Promise((resolve, reject) => {
      if (window.html2canvas) return resolve(window.html2canvas);
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      script.onload = () => resolve(window.html2canvas);
      script.onerror = () => reject(new Error('Could not load html2canvas from CDN'));
      document.head.appendChild(script);
    });
  }

  async function takeScreenshot() {
    if (isCapturing) return;
    isCapturing = true;
    errorBox.style.display = 'none';

    // Update capture button state
    captureBtn.innerHTML = `
      <svg class="animate-spin" style="animation: spin 1s linear infinite;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>
      Capturing...
    `;
    
    // Inject spinner CSS keyframes dynamically
    if (!document.getElementById('rag-spin-style')) {
      const spinStyle = document.createElement('style');
      spinStyle.id = 'rag-spin-style';
      spinStyle.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(spinStyle);
    }

    // Hide entire container during screen capture
    container.style.visibility = 'hidden';

    // Await layout paint
    await new Promise(resolve => setTimeout(resolve, 200));

    try {
      await loadHtml2Canvas();
      
      const canvas = await window.html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        logging: false,
      });

      // Save original canvas reference
      originalCanvas = canvas;

      // Draw original canvas on the cropper canvas
      cropperCanvas.width = canvas.width;
      cropperCanvas.height = canvas.height;
      drawCanvasWithMask();

      // Reset selection state
      cropStart = null;
      cropEnd = null;
      cropConfirm.disabled = true;

      // Open cropper overlay
      cropperOverlay.classList.add('open');
    } catch (err) {
      console.error(err);
      errorBox.textContent = 'Failed to take screenshot, but you can still submit a note.';
      errorBox.style.display = 'block';
    } finally {
      container.style.visibility = 'visible';
      isCapturing = false;
      captureBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
        Snapshot Current View
      `;
    }
  }

  // Canvas Mask Dimming Drawing Utility
  function drawCanvasWithMask(startX, startY, endX, endY) {
    const ctx = cropperCanvas.getContext('2d');
    ctx.clearRect(0, 0, cropperCanvas.width, cropperCanvas.height);
    ctx.drawImage(originalCanvas, 0, 0);

    if (startX !== undefined && endX !== undefined) {
      const x = Math.min(startX, endX);
      const y = Math.min(startY, endY);
      const w = Math.abs(startX - endX);
      const h = Math.abs(startY - endY);

      if (w > 0 && h > 0) {
        // Draw semi-transparent dimming masks surrounding selection
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        
        // 1. Top box
        ctx.fillRect(0, 0, cropperCanvas.width, y);
        // 2. Bottom box
        ctx.fillRect(0, y + h, cropperCanvas.width, cropperCanvas.height - (y + h));
        // 3. Left box
        ctx.fillRect(0, y, x, h);
        // 4. Right box
        ctx.fillRect(x + w, y, cropperCanvas.width - (x + w), h);

        // Draw dashed selection border
        ctx.strokeStyle = '#4f46e5';
        ctx.lineWidth = Math.max(3, Math.round(cropperCanvas.width / 400));
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(x, y, w, h);
      }
    }
  }

  // Coordinate computation utility
  function getMousePos(e) {
    const rect = cropperCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    // Scale viewport clicks to matches actual canvas buffers
    const scaleX = cropperCanvas.width / rect.width;
    const scaleY = cropperCanvas.height / rect.height;
    
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  // Cropper Event Listeners
  cropperCanvasContainer.addEventListener('mousedown', startCropSelection);
  cropperCanvasContainer.addEventListener('touchstart', startCropSelection);

  function startCropSelection(e) {
    if (e.type === 'touchstart') e.preventDefault(); // Prevent scrolling on touch drag
    const pos = getMousePos(e);
    cropStart = pos;
    cropEnd = pos;
    isDrawing = true;
    cropConfirm.disabled = true;
  }

  window.addEventListener('mousemove', drawCropSelection);
  window.addEventListener('touchmove', drawCropSelection);

  function drawCropSelection(e) {
    if (!isDrawing || !cropStart) return;
    const pos = getMousePos(e);
    cropEnd = pos;

    drawCanvasWithMask(cropStart.x, cropStart.y, pos.x, pos.y);

    const w = Math.abs(cropStart.x - pos.x);
    const h = Math.abs(cropStart.y - pos.y);
    if (w > 10 && h > 10) {
      cropConfirm.disabled = false;
    }
  }

  window.addEventListener('mouseup', endCropSelection);
  window.addEventListener('touchend', endCropSelection);

  function endCropSelection() {
    if (isDrawing) {
      isDrawing = false;
    }
  }

  // Cropper Buttons actions
  cropCancel.addEventListener('click', () => {
    // Keep full screenshot, skip cropping
    const dataUrl = originalCanvas.toDataURL('image/png');
    currentScreenshot = dataUrl;
    previewImg.src = dataUrl;
    
    captureArea.style.display = 'none';
    previewArea.style.display = 'block';
    cropperOverlay.classList.remove('open');
  });

  cropConfirm.addEventListener('click', () => {
    if (!cropStart || !cropEnd) return;

    const startX = Math.min(cropStart.x, cropEnd.x);
    const startY = Math.min(cropStart.y, cropEnd.y);
    const width = Math.abs(cropStart.x - cropEnd.x);
    const height = Math.abs(cropStart.y - cropEnd.y);

    if (width < 5 || height < 5) return;

    // Perform native Canvas Slicing
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = width;
    croppedCanvas.height = height;

    const croppedCtx = croppedCanvas.getContext('2d');
    croppedCtx.drawImage(
      originalCanvas,
      startX, startY, width, height, // Source bounds
      0, 0, width, height            // Destination bounds
    );

    const dataUrl = croppedCanvas.toDataURL('image/png');
    currentScreenshot = dataUrl;
    previewImg.src = dataUrl;

    captureArea.style.display = 'none';
    previewArea.style.display = 'block';
    cropperOverlay.classList.remove('open');
  });

  // Main UI actions
  captureBtn.addEventListener('click', takeScreenshot);
  retakeBtn.addEventListener('click', takeScreenshot);
  
  removeBtn.addEventListener('click', () => {
    currentScreenshot = null;
    previewImg.src = '';
    previewArea.style.display = 'none';
    captureArea.style.display = 'block';
  });

  submitBtn.addEventListener('click', async () => {
    const textVal = textInput.value.trim();
    if (!textVal) {
      errorBox.textContent = 'Please describe your feedback.';
      errorBox.style.display = 'block';
      return;
    }

    errorBox.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    try {
      let screenshotUrl = '';

      if (currentScreenshot) {
        try {
          const uuid = Math.random().toString(36).substring(2, 15);
          const nameEncoded = encodeURIComponent(`feedback-screenshots/${uuid}.png`);
          
          // Convert Base64 Data URL to Blob
          const resBlob = await fetch(currentScreenshot);
          const blob = await resBlob.blob();

          // Upload to Storage using standard public REST API
          const uploadRes = await fetch(`https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o?uploadType=media&name=${nameEncoded}`, {
            method: 'POST',
            headers: { 'Content-Type': 'image/png' },
            body: blob
          });

          if (uploadRes.ok) {
            screenshotUrl = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/feedback-screenshots%2F${uuid}.png?alt=media`;
          } else {
            console.warn('Storage upload failed with status:', uploadRes.status);
            errorBox.textContent = 'Warning: Screenshot failed to upload. Submitting written note only.';
            errorBox.style.display = 'block';
          }
        } catch (uploadErr) {
          console.warn('Image upload failed, falling back to text submission:', uploadErr);
          errorBox.textContent = 'Warning: Screenshot failed to upload. Submitting written note only.';
          errorBox.style.display = 'block';
        }
      }

      // Submit feedback to API
      const apiRes = await fetch(`${apiBaseUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          clientName: nameInput.value.trim() || 'Anonymous',
          clientEmail: emailInput.value.trim() || null,
          rawText: textVal,
          screenshotUrl: screenshotUrl || null,
          pageUrl: window.location.href,
        })
      });

      const data = await apiRes.json();
      if (!apiRes.ok) {
        throw new Error(data.error || 'Failed to submit feedback');
      }

      // Show Success state
      formBody.style.display = 'none';
      successBody.style.display = 'block';

      if (data.interpretation) {
        successSummary.textContent = data.interpretation.summary;
        badgesArea.innerHTML = `
          <span class="rag-widget-badge rag-widget-badge-category">${data.interpretation.category}</span>
          <span class="rag-widget-badge rag-widget-badge-urgency">${data.interpretation.urgency} urgency</span>
        `;
        interpretationArea.style.display = 'block';
      }
    } catch (err) {
      console.error(err);
      errorBox.textContent = err.message || 'An error occurred during submission.';
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Feedback';
    }
  });

  resetBtn.addEventListener('click', () => {
    textInput.value = '';
    currentScreenshot = null;
    previewImg.src = '';
    previewArea.style.display = 'none';
    captureArea.style.display = 'block';
    interpretationArea.style.display = 'none';
    successBody.style.display = 'none';
    formBody.style.display = 'block';
  });

})();
