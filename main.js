import * as THREE from 'three';

// ==========================================
// 【三档位核心参数】
// ==========================================
const ZOOM_LEVELS = [25, 15, 5.5]; 
let currentLevelIndex = 0;         

const BASE_PHOTO_SIZE = 1.3;    
const MAX_SCALE_FACTOR = 2.0;      
const ZOOM_SENSITIVITY = 18;       
// ==========================================

let scene, camera, renderer, planetGroup, planetParticles;
let photoMeshes = []; 
let targetZoom = ZOOM_LEVELS[0], currentZoom = ZOOM_LEVELS[0];

let rotationVelocity = { x: 0, y: 0 }, friction = 0.94; 
const targetQuaternion = new THREE.Quaternion();
const currentQuaternion = new THREE.Quaternion();
let currentEuler = new THREE.Euler(Math.PI / 6, -Math.PI / 8, 0, 'YXZ'); 

let lastFingerPos = null, lastHandState = 'neutral';
let hasTriggeredThisAction = false; 

document.getElementById('start-btn').addEventListener('click', () => {
    const screen = document.getElementById('start-screen');
    const ins = document.getElementById('instructions');
    screen.classList.add('fade-out');
    init3D(); 
    setTimeout(() => {
        screen.style.display = 'none';
        if(ins) { ins.style.display = 'flex'; void ins.offsetWidth; ins.classList.add('fade-in'); }
        const title = document.querySelector('.scene-title');
        if(title) title.classList.add('fade-in');
        setTimeout(startAISystem, 500); 
    }, 1500);
});

async function processImage(dataUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = dataUrl;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, 1024 / img.width);
            canvas.width = img.width * scale; canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const tex = new THREE.CanvasTexture(canvas);
            tex.needsUpdate = true; resolve(tex);
        };
    });
}

async function init3D() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.getElementById('container').appendChild(renderer.domElement);

    planetGroup = new THREE.Group();
    scene.add(planetGroup);

    const textureLoader = new THREE.TextureLoader();
    const sprite = textureLoader.load('https://threejs.org/examples/textures/sprites/disc.png');
    const circleMask = textureLoader.load('https://threejs.org/examples/textures/sprites/ball.png');

    const geo = new THREE.BufferGeometry();
    const count = 30000, pos = new Float32Array(count * 3), cols = new Float32Array(count * 3);
    const colorPink = new THREE.Color(0xffc0cb), colorBlue = new THREE.Color(0xa2d2ff); 
    for (let i = 0; i < count; i++) {
        const phi = Math.acos(-1 + (2 * i) / count), theta = Math.sqrt(count * Math.PI) * phi, r = 4;
        pos[i*3] = r * Math.cos(theta) * Math.sin(phi); pos[i*3+1] = r * Math.sin(theta) * Math.sin(phi); pos[i*3+2] = r * Math.cos(phi);
        const mix = (pos[i*3+1] + 4) / 8;
        const finalC = colorPink.clone().lerp(colorBlue, mix + (Math.random()-0.5)*0.2);
        cols[i*3] = finalC.r; cols[i*3+1] = finalC.g; cols[i*3+2] = finalC.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    planetParticles = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.025, vertexColors: true, map: sprite, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    planetGroup.add(planetParticles);

    const photos = window.finalPhotos || [];
    for (let i = 0; i < photos.length; i++) {
        const tex = await processImage(photos[i]);
        const aspect = tex.image.width / tex.image.height;
        let w = BASE_PHOTO_SIZE, h = BASE_PHOTO_SIZE;
        aspect > 1 ? (h = BASE_PHOTO_SIZE / aspect) : (w = BASE_PHOTO_SIZE * aspect);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, alphaMap: circleMask, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
        const phi = Math.acos(-1 + (2 * i) / photos.length), theta = Math.sqrt(photos.length * Math.PI) * phi, r = 4.02;
        mesh.position.set(r * Math.cos(theta) * Math.sin(phi), r * Math.sin(theta) * Math.sin(phi), r * Math.cos(phi));
        mesh.lookAt(0, 0, 0);
        mesh.userData = { originalMap: tex, randomScale: 0.8 + Math.random() * 0.4 };
        photoMeshes.push(mesh); planetGroup.add(mesh);
    }

    planetGroup.add(createRing(5.4, 0.02, 0.2, 8000, 0.1));
    planetGroup.add(createRing(6.2, 0.015, 0.1, 5000, 0.15));
    
    const starGeo = new THREE.BufferGeometry(), starPos = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
        const r = 400 + Math.random() * 200, t = Math.random()*Math.PI*2, p = Math.acos(2*Math.random()-1);
        starPos[i*3]=r*Math.sin(p)*Math.cos(t); starPos[i*3+1]=r*Math.sin(p)*Math.sin(t); starPos[i*3+2]=r*Math.cos(p);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, transparent: true, opacity: 0.4 })));

    const name = localStorage.getItem('userPlanetName') || "KLA";
    const title = document.createElement('div');
    title.className = 'scene-title';
    title.innerText = name + " PLANET";
    document.body.appendChild(title);

    targetQuaternion.setFromEuler(currentEuler);
    currentQuaternion.copy(targetQuaternion);
    animate();
}

function createRing(r_base, p_size, op, count, thickness) {
    const g = new THREE.BufferGeometry(), p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const a = (i/count)*Math.PI*2, r = r_base + (Math.random()-0.5)*1.0;
        p[i*3] = Math.cos(a)*r; p[i*3+1] = (Math.random()-0.5)*thickness; p[i*3+2] = Math.sin(a)*r;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ size: p_size, color: 0xffffff, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
}

async function startAISystem() {
    const video = document.querySelector('.input_video');
    const hands = new window.Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    
    // 强制提高模型复杂度以获得更准确的手指位置
    hands.setOptions({ 
        maxNumHands: 1, 
        modelComplexity: 1, 
        minDetectionConfidence: 0.8, 
        minTrackingConfidence: 0.8 
    });
    
    hands.onResults((res) => {
        if (res.multiHandLandmarks && res.multiHandLandmarks.length > 0) {
            const lm = res.multiHandLandmarks[0];
            
            // --- 精准手势逻辑重写 ---

            // 1. 只有当食指伸直，且其它三根手指明显弯曲时，才判定为“旋转模式”
            const isIndexUp = lm[8].y < lm[6].y;
            const isMiddleDown = lm[12].y > lm[10].y;
            const isRingDown = lm[16].y > lm[14].y;
            const isPinkyDown = lm[20].y > lm[18].y;

            const isPureRotateMode = isIndexUp && isMiddleDown && isRingDown && isPinkyDown;

            // 2. 握拳判定：必须所有手指都缩回，且手掌心被遮挡（y轴判定）
            const isFist = lm[8].y > lm[5].y && lm[12].y > lm[9].y && lm[16].y > lm[13].y && lm[20].y > lm[17].y;
            
            // 3. 张手判定：所有指尖必须大幅高于关节点
            const isOpen = lm[8].y < lm[5].y && lm[12].y < lm[9].y && lm[16].y < lm[13].y && lm[20].y < lm[17].y;

            // --- 行为分发 ---

            // 旋转：必须满足 PureRotateMode
            if (isPureRotateMode) {
                const curPos = { x: lm[8].x, y: lm[8].y };
                if (lastFingerPos) {
                    rotationVelocity.x = (curPos.x - lastFingerPos.x) * 4;
                    rotationVelocity.y = (curPos.y - lastFingerPos.y) * 4;
                }
                lastFingerPos = curPos;
                // 旋转模式下，强制锁定缩放状态，防止误触
                lastHandState = 'neutral'; 
                return; 
            } else {
                lastFingerPos = null;
            }

            // 缩放逻辑 (仅在非旋转模式下生效)
            const pose = isFist ? 'fist' : (isOpen ? 'open' : 'neutral');
            if (pose === 'neutral') {
                hasTriggeredThisAction = false;
            }

            if (lastHandState === 'fist' && pose === 'open' && !hasTriggeredThisAction) {
                if (currentLevelIndex < ZOOM_LEVELS.length - 1) {
                    currentLevelIndex++;
                    targetZoom = ZOOM_LEVELS[currentLevelIndex];
                    hasTriggeredThisAction = true;
                }
            } else if (lastHandState === 'open' && pose === 'fist' && !hasTriggeredThisAction) {
                if (currentLevelIndex > 0) {
                    currentLevelIndex--;
                    targetZoom = ZOOM_LEVELS[currentLevelIndex];
                    hasTriggeredThisAction = true;
                }
            }

            lastHandState = pose;
        }
    });
    const cam = new window.Camera(video, { onFrame: async () => await hands.send({ image: video }), width: 640, height: 480 });
    cam.start();
}

function animate() {
    requestAnimationFrame(animate);
    if (Math.abs(rotationVelocity.x) > 0.001 || Math.abs(rotationVelocity.y) > 0.001) {
        currentEuler.y -= rotationVelocity.x * 0.15;
        currentEuler.x = THREE.MathUtils.clamp(currentEuler.x - rotationVelocity.y * 0.15, -0.8, 0.8);
        targetQuaternion.setFromEuler(currentEuler);
        rotationVelocity.x *= friction; rotationVelocity.y *= friction;
    }
    currentQuaternion.slerp(targetQuaternion, 0.1); planetGroup.quaternion.copy(currentQuaternion);
    
    currentZoom += (targetZoom - currentZoom) * 0.08; 
    camera.position.z = currentZoom; camera.lookAt(0,0,0);

    const baseOp = THREE.MathUtils.mapLinear(currentZoom, 22, 16, 0, 1);
    const breathe = Math.sin(Date.now() * 0.002) * 0.1 + 0.9;
    const dynScale = THREE.MathUtils.mapLinear(currentZoom, 15, 5.5, 1, MAX_SCALE_FACTOR);

    photoMeshes.forEach(m => {
        m.material.opacity = THREE.MathUtils.clamp(baseOp * breathe, 0, 1);
        const s = dynScale * (m.userData.randomScale || 1);
        m.scale.set(s, s, s);
    });
    renderer.render(scene, camera);
}

window.addEventListener('click', (e) => {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((e.clientX/window.innerWidth)*2-1, -(e.clientY/window.innerHeight)*2+1), camera);
    const hits = ray.intersectObjects(photoMeshes);
    if (hits[0] && hits[0].object.material.opacity > 0.4) {
        document.getElementById('full-res-img').src = hits[0].object.userData.originalMap.image.src;
        document.getElementById('photo-overlay').style.display = 'flex';
    }
});