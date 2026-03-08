// 1. DATABASE INITIALIZATION
const db = new Dexie("TextureS");
db.version(1).stores({ 
    assets: "++id, name, data, category" 
});

// 2. THREE.JS GLOBAL STATE
let scene, camera, renderer, controls, sphere, material;

function init3D() {
    scene = new THREE.Scene();
    
    // Camera setup for background depth
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('viewer').appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Lighting for realistic material preview
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(5, 5, 5);
    scene.add(sun);

    // Preview Sphere
    material = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
    sphere = new THREE.Mesh(new THREE.SphereGeometry(1.8, 64, 64), material);
    scene.add(sphere);

    // Responsive Resize Logic
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }
    animate();
}

// 3. LIBRARY & DATABASE ACTIONS
async function refreshLibrary() {
    const items = await db.assets.toArray();
    const search = document.getElementById('nameSearch').value.toLowerCase();
    const filter = document.getElementById('viewFilter').value;

    // Update Category Dropdown dynamically
    const cats = [...new Set(items.map(i => i.category))].filter(Boolean).sort();
    document.getElementById('viewFilter').innerHTML = '<option value="All">All Categories</option>' + 
        cats.map(c => `<option value="${c}">${c}</option>`).join('');
    document.getElementById('viewFilter').value = filter;

    const filtered = items.filter(i => 
        (filter === 'All' || i.category === filter) && 
        i.name.toLowerCase().includes(search)
    );

    // Render Grid with Individual Download & Delete buttons
    document.getElementById('library').innerHTML = filtered.map(i => `
        <div class="tex-card" onclick="applyTex('${i.data}')">
            <img src="${i.data}" loading="lazy">
            <div class="card-info">
                <span class="card-name">${i.name}</span>
                <div class="card-actions">
                    <span class="action-btn download-btn" onclick="downloadSingle(event, '${i.data}', '${i.name}')" title="Download">⬇️</span>
                    <span class="action-btn del-btn" onclick="deleteItem(event, ${i.id})" title="Delete">×</span>
                </div>
            </div>
        </div>
    `).join('');
}

// 4. TEXTURE INTERACTION
window.applyTex = (data) => {
    new THREE.TextureLoader().load(data, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        const uv = document.getElementById('uvScale').value;
        t.repeat.set(uv, uv);
        material.map = t; 
        material.color.set(0xffffff); 
        material.needsUpdate = true;
    });
    document.getElementById('pureImage').src = data;
};

window.updateUV = (v) => { if(material.map) material.map.repeat.set(v, v); };

window.downloadSingle = (e, data, name) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = data;
    a.download = `${name || 'texture'}.png`;
    a.click();
};

window.deleteItem = async (e, id) => {
    e.stopPropagation();
    if(confirm("Delete this texture?")) {
        await db.assets.delete(id);
        refreshLibrary();
    }
};

window.clearLibrary = async () => {
    if(confirm("Delete everything? This cannot be undone.")) {
        await db.assets.clear();
        refreshLibrary();
    }
};

// 5. UPLOAD & BACKUP
document.getElementById('fileIn').onchange = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
        await db.assets.add({ 
            name: document.getElementById('assetName').value || file.name, 
            category: document.getElementById('catInput').value || 'General', 
            data: ev.target.result 
        });
        document.getElementById('assetName').value = ""; 
        refreshLibrary();
    };
    reader.readAsDataURL(file);
};

window.exportLibrary = async () => {
    const data = await db.assets.toArray();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], {type:'application/json'}));
    a.download = `TextureHub_Backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
};

window.importLibrary = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // STEP 1: Initial "Are you sure?"
    const proceed = confirm(`Are you sure you want to restore from "${file.name}"?`);
    if (!proceed) {
        e.target.value = ""; // Reset input
        return;
    }

    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            
            // STEP 2: Wipe vs Merge choice
            const shouldOverwrite = confirm(
                "WIPE CURRENT LIBRARY?\n\n" +
                "OK: Clear everything and start fresh with this file.\n" +
                "Cancel: Keep current textures and just add these new ones."
            );
            
            if (shouldOverwrite) {
                await db.assets.clear();
            }

            for (let item of data) {
                delete item.id; // Prevent ID conflicts
                await db.assets.add(item);
            }
            
            alert(`Success! Restored ${data.length} textures.`);
            refreshLibrary();
            e.target.value = ""; 
        } catch (err) {
            console.error(err);
            alert("Restore failed: The file is not a valid Texture Hub backup.");
            e.target.value = "";
        }
    };
    reader.readAsText(file);
};

// 6. RESOLUTION MODE (SMOOTH DRAG & ZOOM)
const overlay = document.getElementById('pureViewOverlay');
const pImg = document.getElementById('pureImage');
let zoom = 0.8, dragging = false, currentPos = { x: 0, y: 0 }, startMouse = { x: 0, y: 0 }, lastPos = { x: 0, y: 0 };

window.openPure = () => {
    if(!pImg.src || pImg.src === "" || pImg.src.includes(window.location.hostname)) return;
    overlay.style.display = 'block';
    zoom = 0.8; 
    currentPos.x = window.innerWidth / 2;
    currentPos.y = window.innerHeight / 2;
    lastPos = { ...currentPos };
    updateImg();
};

window.closePure = () => overlay.style.display = 'none';

// Image Movement Logic
overlay.onmousedown = (e) => { 
    dragging = true; 
    overlay.style.cursor = 'grabbing'; 
    startMouse = { x: e.clientX, y: e.clientY }; 
};

window.onmousemove = (e) => {
    if (!dragging) return;
    currentPos.x = lastPos.x + (e.clientX - startMouse.x);
    currentPos.y = lastPos.y + (e.clientY - startMouse.y);
    updateImg();
};

window.onmouseup = () => { 
    if(dragging) { 
        dragging = false; 
        overlay.style.cursor = 'grab'; 
        lastPos = { ...currentPos }; 
    } 
};

overlay.onwheel = (e) => { 
    e.preventDefault(); 
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    zoom = Math.min(Math.max(0.1, zoom * delta), 10); 
    updateImg(); 
};

function updateImg() { 
    pImg.style.transform = `translate(-50%, -50%) translate(${currentPos.x}px, ${currentPos.y}px) scale(${zoom})`; 
}

// 7. BOOTSTRAP
window.onload = () => {
    init3D();
    refreshLibrary();
};