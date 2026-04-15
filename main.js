import * as THREE from 'three';

// ==========================================
// 【私人调节参数】
// ==========================================
const BASE_PHOTO_SIZE = 1.3;    
const MAX_SCALE_FACTOR = 2.5;   
const ZOOM_SENSITIVITY = 18;    
// ==========================================

let scene, camera, renderer, planetGroup, planetParticles;
let photoMeshes = []; 
let targetZoom = 25, currentZoom = 25;
const ZOOM_STEP = 7, MIN_DIST = 5, MAX_DIST = 45; 

// 旋转变量
let rotationVelocity = { x: 0, y: 0 }, friction = 0.94; 
const targetQuaternion = new THREE.Quaternion();
const currentQuaternion = new THREE.Quaternion();
// 用于垂直限位的欧拉角
let currentEuler = new THREE.Euler(Math.PI / 6, -Math.PI / 8, 0, 'YXZ'); 

let lastFingerPos = null;
let lastHandState = 'neutral', lastActionTime = 0, cooldownPeriod = 1000;

document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('start-screen').style.opacity = '0';
    setTimeout(() => {
        document.getElementById('start-screen').style.display = 'none';
        const ins = document.getElementById('instructions');
        if(ins) ins.style.display = 'flex'; 
        init3D(); 
        setTimeout(startAISystem, 1000); 
    }, 800);
});

function init3D() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.getElementById('container').appendChild(renderer.domElement);

    const textureLoader = new THREE.TextureLoader();
    const sprite = textureLoader.load('https://threejs.org/examples/textures/sprites/disc.png');
    const circleMask = textureLoader.load('https://threejs.org/examples/textures/sprites/ball.png');

    planetGroup = new THREE.Group();
    scene.add(planetGroup);

    // 1. 梦幻配色星球核心
    const geo = new THREE.BufferGeometry();
    const count = 30000;
    const pos = new Float32Array(count * 3), cols = new Float32Array(count * 3);
    const colorPink = new THREE.Color(0xffc0cb), colorBlue = new THREE.Color(0xa2d2ff); 

    for (let i = 0; i < count; i++) {
        const phi = Math.acos(-1 + (2 * i) / count), theta = Math.sqrt(count * Math.PI) * phi, r = 4;
        pos[i*3] = r * Math.cos(theta) * Math.sin(phi);
        pos[i*3+1] = r * Math.sin(theta) * Math.sin(phi);
        pos[i*3+2] = r * Math.cos(phi);
        const mix = (pos[i*3+1] + 4) / 8;
        const finalC = colorPink.clone().lerp(colorBlue, mix + (Math.random()-0.5)*0.2);
        cols[i*3] = finalC.r; cols[i*3+1] = finalC.g; cols[i*3+2] = finalC.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    planetParticles = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 0.025, vertexColors: true, map: sprite, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    planetGroup.add(planetParticles);

    // 2. 照片缩略图
    const photos = window.finalPhotos || [];
    photos.forEach((dataUrl, i) => {
        textureLoader.load(dataUrl, (tex) => {
            const aspect = tex.image.width / tex.image.height;
            let width = BASE_PHOTO_SIZE, height = BASE_PHOTO_SIZE;
            aspect > 1 ? (height = BASE_PHOTO_SIZE / aspect) : (width = BASE_PHOTO_SIZE * aspect);

            const mesh = new THREE.Mesh(
                new THREE.PlaneGeometry(width, height),
                new THREE.MeshBasicMaterial({
                    map: tex, alphaMap: circleMask, transparent: true, opacity: 0,
                    side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
                })
            );
            const phi = Math.acos(-1 + (2 * i) / photos.length);
            const theta = Math.sqrt(photos.length * Math.PI) * phi, r = 4.02;
            mesh.position.set(r * Math.cos(theta) * Math.sin(phi), r * Math.sin(theta) * Math.sin(phi), r * Math.cos(phi));
            mesh.lookAt(0, 0, 0);
            mesh.userData = { originalMap: tex, randomScale: 0.8 + Math.random() * 0.5 };
            photoMeshes.push(mesh);
            planetGroup.add(mesh);
        });
    });

    // 3. 星环粒子
    planetGroup.add(createRing(5.4, 0.02, 0.2, 8000, 0.1));
    planetGroup.add(createRing(6.2, 0.015, 0.1, 5000, 0.15));
    
    // 4. 背景星空
    const starGeo = new THREE.BufferGeometry(), starPos = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
        const r = 400 + Math.random() * 200;
        const t = Math.random()*Math.PI*2, p = Math.acos(2*Math.random()-1);
        starPos[i*3]=r*Math.sin(p)*Math.cos(t); starPos[i*3+1]=r*Math.sin(p)*Math.sin(t); starPos[i*3+2]=r*Math.cos(p);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, transparent: true, opacity: 0.4 })));

    targetQuaternion.setFromEuler(currentEuler);
    currentQuaternion.copy(targetQuaternion);

    window.addEventListener('click', onPhotoClick);
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
    if (typeof window.Hands === 'undefined') return;
    const video = document.querySelector('.input_video');
    const hands = new window.Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    
    // 提高模型复杂度以解决识别不灵敏问题
    hands.setOptions({ 
        maxNumHands: 1, 
        modelComplexity: 1, 
        minDetectionConfidence: 0.5, 
        minTrackingConfidence: 0.5 
    });
    
    hands.onResults((res) => {
        if (res.multiHandLandmarks && res.multiHandLandmarks.length > 0) {
            const lm = res.multiHandLandmarks[0], now = Date.now();
            
            // 精准判定：食指
            const isIndexUp = lm[8].y < lm[6].y && lm[12].y > lm[10].y && lm[16].y > lm[14].y;
            // 精准判定：握拳 (大拇指除外的四指都低于关节点)
            const isFist = lm[8].y > lm[6].y && lm[12].y > lm[10].y && lm[16].y > lm[14].y && lm[20].y > lm[18].y;
            // 精准判定：张手 (指尖明显高于指根)
            const isOpen = lm[8].y < lm[5].y && lm[12].y < lm[9].y && lm[16].y < lm[13].y && lm[20].y < lm[17].y;

            // 1. 旋转逻辑 (仅食指)
            if (isIndexUp && !isFist && !isOpen) {
                const curPos = { x: lm[8].x, y: lm[8].y };
                if (lastFingerPos) {
                    rotationVelocity.x = (curPos.x - lastFingerPos.x) * 4;
                    rotationVelocity.y = (curPos.y - lastFingerPos.y) * 4;
                }
                lastFingerPos = curPos;
            } else { lastFingerPos = null; }

            // 2. 缩放逻辑
            const pose = isFist ? 'fist' : (isOpen ? 'open' : 'neutral');
            if (now - lastActionTime > cooldownPeriod) {
                if (lastHandState === 'fist' && pose === 'open') { targetZoom -= ZOOM_STEP; lastActionTime = now; }
                else if (lastHandState === 'open' && pose === 'fist') { targetZoom += ZOOM_STEP; lastActionTime = now; }
            }
            if (pose !== 'neutral') lastHandState = pose;
        }
    });
    const cam = new window.Camera(video, { onFrame: async () => { await hands.send({ image: video }); }, width: 640, height: 480 });
    cam.start();
}

function animate() {
    requestAnimationFrame(animate);
    
    if (Math.abs(rotationVelocity.x) > 0.001 || Math.abs(rotationVelocity.y) > 0.001) {
        // 更新欧拉角
        currentEuler.y -= rotationVelocity.x * 0.15; // 横向无限转
        currentEuler.x -= rotationVelocity.y * 0.15; // 纵向控制
        
        // 【核心优化】锁定纵向极限：防止同心圆视角 (正负 0.8 弧度约为 45 度)
        currentEuler.x = THREE.MathUtils.clamp(currentEuler.x, -0.8, 0.8);
        
        targetQuaternion.setFromEuler(currentEuler);
        rotationVelocity.x *= friction; 
        rotationVelocity.y *= friction;
    }
    
    currentQuaternion.slerp(targetQuaternion, 0.1); 
    planetGroup.quaternion.copy(currentQuaternion);

    targetZoom = THREE.MathUtils.clamp(targetZoom, MIN_DIST, MAX_DIST);
    currentZoom += (targetZoom - currentZoom) * 0.1;
    camera.position.z = currentZoom;
    camera.lookAt(0, 0, 0);

    // 联动逻辑
    const baseOp = THREE.MathUtils.mapLinear(currentZoom, ZOOM_SENSITIVITY, 10, 0, 1);
    const breathe = Math.sin(Date.now() * 0.002) * 0.1 + 0.9;
    const dynamicScale = THREE.MathUtils.mapLinear(currentZoom, 20, 5, 1, MAX_SCALE_FACTOR);

    photoMeshes.forEach(m => {
        m.material.opacity = THREE.MathUtils.clamp(baseOp * breathe, 0, 1);
        const s = dynamicScale * (m.userData.randomScale || 1);
        m.scale.set(s, s, s);
    });

    renderer.render(scene, camera);
}

function onPhotoClick(event) {
    const ray = new THREE.Raycaster();
    const m = new THREE.Vector2((event.clientX/window.innerWidth)*2-1, -(event.clientY/window.innerHeight)*2+1);
    ray.setFromCamera(m, camera);
    const hits = ray.intersectObjects(photoMeshes);
    if (hits.length > 0 && hits[0].object.material.opacity > 0.3) {
        document.getElementById('full-res-img').src = hits[0].object.userData.originalMap.image.src;
        document.getElementById('photo-overlay').style.display = 'flex';
    }
}