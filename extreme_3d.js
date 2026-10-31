// ==UserScript==
// @name         Gemini 3D Theme
// @namespace    http://tampermonkey.net/
// @version      1
// @description  45-degree tilts enlarged floating icons deep space theme full UI animations.
// @author       me
// @match        https://gemini.google.com/*
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    const css = `
        :root {
            --3d-primary: #0ff;       
            --3d-secondary: #b026ff;  
            --3d-bg: #020205;         
            --3d-surface: rgba(30, 30, 50, 0.8);
            --tilt-extreme: 45deg;    
        }

        body, main, .chat-app, mat-sidenav-container {
            background-color: var(--3d-bg) !important;
            color: #e0e0ff !important;
            perspective: 1200px;
            overflow-x: hidden;
        }

        
        button:has(.suggestion-card),
        button:has(.condensed-prompt-container),
        toolbox-drawer-item button,
        main button:not(.mat-mdc-icon-button):not(.mdc-icon-button):not(.file-uploader button) {
            transform-style: preserve-3d;
            transform: perspective(800px) rotateX(var(--tilt-extreme)) rotateY(-15deg) translateZ(0);
            transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1),
                        box-shadow 0.4s ease,
                        background 0.4s ease;

            background: linear-gradient(135deg, rgba(40,40,60,0.6), rgba(10,10,20,0.9)) !important;
            border: 1px solid rgba(255,255,255,0.15) !important;
            border-left: 5px solid var(--3d-primary) !important;
            box-shadow: 0 20px 30px rgba(0,0,0,0.7);
            border-radius: 20px !important;
            margin: 15px !important;
            padding: 8px !important;
            position: relative;
        }

        
        button:has(.suggestion-card):hover,
        toolbox-drawer-item button:hover,
        main button:not(.mat-mdc-icon-button):not(.mdc-icon-button):not(.file-uploader button):hover {
            transform: perspective(800px) rotateX(0deg) rotateY(0deg) scale(1.15) translateZ(50px);
            z-index: 1000;
            background: linear-gradient(135deg, rgba(50,50,80,0.95), rgba(20,20,40,1)) !important;
            border-color: var(--3d-primary) !important;
            box-shadow: 0 0 25px var(--3d-primary), 0 0 60px rgba(176, 38, 255, 0.5);
        }

        
        toolbox-drawer-item button mat-icon,
        button:has(.suggestion-card) mat-icon,
        main button:not(.file-uploader button) mat-icon,
        main button:not(.file-uploader button) img {
            transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            transform-origin: center center;
        }

        toolbox-drawer-item button:hover mat-icon,
        button:has(.suggestion-card):hover mat-icon,
        main button:not(.mat-mdc-icon-button):not(.file-uploader button):hover mat-icon {
            transform: scale(3.5) translateZ(20px) translateX(15px);
            filter: drop-shadow(0 0 10px var(--3d-primary));
            z-index: 1001;
            position: relative;
        }

        
        .file-uploader button, button[aria-label="Open upload file menu"] {
            transform-style: preserve-3d;
            background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%) !important;
            border: 2px dashed var(--3d-primary) !important;
            border-radius: 50% !important;
            transition: all 0.5s ease;
            box-shadow: 0 0 10px var(--3d-primary);
            animation: float 3s infinite ease-in-out;
        }

        .file-uploader button:hover, button[aria-label="Open upload file menu"]:hover {
            transform: scale(1.3) rotate(180deg);
            box-shadow: 0 0 30px var(--3d-secondary), inset 0 0 20px var(--3d-primary);
            background: radial-gradient(circle, rgba(0,255,255,0.2) 0%, transparent 70%) !important;
            border-style: solid !important;
        }

        @keyframes float {
            0% { transform: translateY(0px); }
            50% { transform: translateY(-5px); }
            100% { transform: translateY(0px); }
        }

        
        .bard-mode-list-button, button[role="menuitemradio"], button[data-test-id*="bard-mode"] {
            transform-origin: top center;
            transform: perspective(600px) rotateX(-20deg);
            background: rgba(255,255,255,0.05) !important;
            border: 1px solid rgba(255,255,255,0.1) !important;
            margin-bottom: 8px !important;
            transition: transform 0.3s, background 0.3s;
        }

        .bard-mode-list-button:hover, button[role="menuitemradio"]:hover {
            transform: perspective(600px) rotateX(0deg) scale(1.05) translateZ(10px);
            background: linear-gradient(90deg, var(--3d-secondary), transparent) !important;
            box-shadow: 0 5px 15px rgba(0,0,0,0.5);
            z-index: 10;
        }

        
        .main-menu-button, button[aria-label="Main menu"], button[data-test-id="side-nav-menu-button"] {
            transition: transform 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55), box-shadow 0.3s;
            border-radius: 50% !important;
        }

        .main-menu-button:hover, button[aria-label="Main menu"]:hover {
            transform: rotate(90deg) scale(1.2);
            background: rgba(0, 255, 255, 0.15) !important;
            box-shadow: 0 0 20px var(--3d-primary);
            color: var(--3d-primary) !important;
        }

        
        button[aria-label*="Upload files"], button[data-test-id="local-images-files-uploader-button"],
        button[aria-label*="Add from Drive"], button[data-test-id="uploader-drive-button"] {
            transform-style: preserve-3d;
            transform: perspective(600px) rotateY(15deg) translateX(-5px);
            background: linear-gradient(90deg, rgba(255,255,255,0.05), transparent) !important;
            border-left: 2px solid transparent;
            transition: all 0.3s ease;
        }

        button[aria-label*="Upload files"]:hover,
        button[data-test-id="local-images-files-uploader-button"]:hover,
        button[aria-label*="Add from Drive"]:hover,
        button[data-test-id="uploader-drive-button"]:hover {
            transform: perspective(600px) rotateY(0deg) translateX(5px) scale(1.02);
            background: linear-gradient(90deg, rgba(0, 255, 255, 0.15), transparent) !important;
            border-left: 4px solid var(--3d-primary);
            box-shadow: 5px 0 15px rgba(0,0,0,0.3);
            z-index: 50;
        }

        
        button[aria-label*="Add from Drive"]:hover {
            border-left-color: #1FA463 !important; 
            box-shadow: 5px 0 15px rgba(31, 164, 99, 0.4);
            background: linear-gradient(90deg, rgba(31, 164, 99, 0.15), transparent) !important;
        }

        
        .conversation-items-container .conversation, .conversation-container {
            transition: all 0.3s ease;
            border-radius: 0 8px 8px 0 !important;
            margin-bottom: 4px;
            border-left: 2px solid transparent;
        }

        .conversation-items-container .conversation:hover {
            background: linear-gradient(90deg, rgba(255,255,255,0.1), transparent) !important;
            transform: translateX(5px);
            border-left: 3px solid var(--3d-primary);
            box-shadow: 5px 0 15px rgba(0,0,0,0.5);
        }

        
        .text-input-field_textarea, .ql-container {
            transform-style: preserve-3d;
            transform: perspective(1000px) rotateX(30deg);
            background: rgba(20,20,25,0.85) !important;
            border-bottom: 5px solid var(--3d-secondary) !important;
            border-radius: 24px !important;
            box-shadow: 0 40px 60px -20px rgba(0,0,0,0.9);
            transition: all 0.5s ease;
            margin-top: 20px;
            margin-bottom: 50px;
        }

        .text-input-field_textarea:focus-within {
            transform: perspective(1000px) rotateX(0deg) scale(1.02);
            box-shadow: 0 0 60px rgba(176, 38, 255, 0.3);
        }

        
        .user-message, [data-sender="user"] {
            transform: rotateY(8deg);
            background: linear-gradient(90deg, #222, #333) !important;
            border-right: 4px solid var(--3d-primary);
            box-shadow: -10px 10px 30px rgba(0,0,0,0.5);
        }

        .model-message, [data-sender="model"] {
            transform: rotateY(-5deg);
            background: rgba(255,255,255,0.04) !important;
            border-left: 4px solid var(--3d-secondary);
            box-shadow: 10px 10px 30px rgba(0,0,0,0.5);
        }

        
        .suggestion-card, .condensed-prompt-container { background: transparent !important; }
    `;

    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    function applyTheme() {
        const msgs = document.querySelectorAll('.message-content, [data-message-id]');
        msgs.forEach(msg => {
            if (!msg.classList.contains('css3d-checked')) {
                msg.classList.add('css3d-checked');
                if (msg.querySelector('.user-avatar') || msg.dataset.sender === 'user') {
                    msg.classList.add('user-message');
                } else {
                    msg.classList.add('model-message');
                }
            }
        });
    }

    const observer = new MutationObserver(() => requestAnimationFrame(applyTheme));
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(applyTheme, 5000);

})();