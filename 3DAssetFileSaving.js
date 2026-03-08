let scene, camera, renderer, controls, currentModel, db;

const dbRequest = indexedDB.open("3DA", 1);
dbRequest.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("models")) {
        db.createObjectStore("models", { keyPath: "id", autoIncrement: true });
    }
};
dbRequest.onsuccess = (e) => {
    db = e.target.result;
    initThreeJS();
    renderDashboard();
};

function initThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020202);
    const container = document.getElementById('viewer');
    
    camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 5000);
    camera.position.set(15, 15, 15);

    renderer = new THREE.WebGLRenderer({ 
        antialias: true, 
        powerPreference: "high-performance",
        logarithmicDepthBuffer: true 
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(10, 20, 10);
    scene.add(sun);
    
    scene.add(new THREE.GridHelper(50, 50, 0x111111, 0x080808));
    animate();
}

// TOPOLOGY REPAIR: Special handling for FBX stretching
function loadModelToScene(asset) {
    const ext = asset.extension;
    const data = asset.fileData;

    const onModelParsed = (model) => {
        if (currentModel) scene.remove(currentModel);

        model.traverse(n => {
            if (n.isMesh) {
                // The OBJ-style fix: Strip indexing to prevent FBX "spiderwebs"
                n.geometry = n.geometry.toNonIndexed();
                n.geometry.computeVertexNormals();

                n.material = new THREE.MeshStandardMaterial({ 
                    color: asset.color, 
                    roughness: 0.5, 
                    metalness: 0.3,
                    side: THREE.DoubleSide,
                    polygonOffset: true,
                    polygonOffsetFactor: -1,
                    polygonOffsetUnits: -1
                });
            }
        });

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        
        currentModel = model;
        scene.add(currentModel);

        const size = box.getSize(new THREE.Vector3()).length();
        camera.position.set(size, size, size);
        controls.target.set(0,0,0);
        controls.update();
    };

    try {
        if (ext === 'obj') onModelParsed(new THREE.OBJLoader().parse(data));
        else if (ext === 'fbx') onModelParsed(new THREE.FBXLoader().parse(data));
        else new THREE.GLTFLoader().parse(data, '', (gltf) => onModelParsed(gltf.scene));
    } catch (err) {
        console.error("Load failed:", err);
    }
}

// MANAGEMENT TOOLS
function toggleWireframe() {
    if (!currentModel) return;
    currentModel.traverse(n => { if (n.isMesh) n.material.wireframe = !n.material.wireframe; });
}

function clearAllAssets() {
    if (!confirm("Wipe the entire library?")) return;
    const transaction = db.transaction(["models"], "readwrite");
    transaction.objectStore("models").clear();
    transaction.oncomplete = () => {
        if (currentModel) scene.remove(currentModel);
        renderDashboard();
    };
}

function renameAsset(id) {
    const newName = prompt("Enter new name:");
    if (!newName) return;
    const transaction = db.transaction(["models"], "readwrite");
    const store = transaction.objectStore("models");
    store.get(id).onsuccess = (e) => {
        const data = e.target.result;
        data.label = newName;
        store.put(data);
        transaction.oncomplete = () => renderDashboard();
    };
}

function downloadMesh(id) {
    db.transaction(["models"], "readonly").objectStore("models").get(id).onsuccess = (e) => {
        const asset = e.target.result;
        const blob = new Blob([asset.fileData], { type: "application/octet-stream" });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${asset.label}.${asset.extension}`;
        link.click();
    };
}

// DASHBOARD RENDERER (Restoring UI)
function renderDashboard() {
    if (!db) return;
    const query = document.getElementById('searchBar').value.toLowerCase();
    const list = document.getElementById('assetList');
    const store = db.transaction(["models"], "readonly").objectStore("models");
    
    store.getAll().onsuccess = (e) => {
        list.innerHTML = e.target.result
            .filter(a => a.label.toLowerCase().includes(query))
            .map(a => `
                <div class="asset-card" onclick='fetchFromDB(${a.id})'>
                    <button class="del-btn" onclick="deleteAsset(event, ${a.id})">✕</button>
                    <strong>${a.label}</strong><br>
                    <small style="opacity:0.5">${a.fileName}</small>
                    <div class="btn-row" style="margin-top:10px;">
                        <button class="secondary-btn" style="font-size:10px; padding:4px;" onclick="event.stopPropagation(); renameAsset(${a.id})">Rename</button>
                        <button class="secondary-btn" style="font-size:10px; padding:4px;" onclick="event.stopPropagation(); downloadMesh(${a.id})">Get File</button>
                    </div>
                    <div class="color-bar" style="background:${a.color}"></div>
                </div>
            `).join('');
    };
}

function renderDashboard() {
    const query = document.getElementById('searchBar').value.toLowerCase();
    const list = document.getElementById('assetList');
    const store = db.transaction(["models"], "readonly").objectStore("models");
    
    store.getAll().onsuccess = (e) => {
        list.innerHTML = e.target.result
            .filter(a => a.label.toLowerCase().includes(query))
            .map(a => `
                <div class="asset-card" onclick='fetchFromDB(${a.id})'>
                    <button class="del-btn" onclick="deleteAsset(event, ${a.id})">✕</button>
                    <strong>${a.label}</strong><br>
                    <small style="opacity:0.5">${a.fileName}</small>
                    <div class="btn-row" style="margin-top:8px;">
                        <button class="secondary-btn" style="font-size:9px;" onclick="event.stopPropagation(); renameAsset(${a.id})">Rename</button>
                        <button class="secondary-btn" style="font-size:9px;" onclick="event.stopPropagation(); downloadMesh(${a.id})">Download</button>
                    </div>
                    <div class="color-bar" style="background:${a.color}"></div>
                </div>
            `).join('');
    };
}

// MANAGEMENT TOOLS
function renameAsset(id) {
    const newName = prompt("New name:");
    if (!newName) return;
    const transaction = db.transaction(["models"], "readwrite");
    const store = transaction.objectStore("models");
    store.get(id).onsuccess = (e) => {
        const data = e.target.result;
        data.label = newName;
        store.put(data);
        transaction.oncomplete = () => renderDashboard();
    };
}

function downloadMesh(id) {
    db.transaction(["models"], "readonly").objectStore("models").get(id).onsuccess = (e) => {
        const asset = e.target.result;
        const blob = new Blob([asset.fileData], { type: "application/octet-stream" });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${asset.label}.${asset.extension}`;
        link.click();
    };
}

async function saveToVault() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];
    const label = document.getElementById('assetLabel').value || "New_Asset";
    const color = document.getElementById('assetColor').value;

    if (!file) return alert("Please select a 3D file first.");

    const extension = file.name.split('.').pop().toLowerCase();

    // FBX TOPOLOGY WARNING
    if (extension === 'fbx') {
        const proceed = confirm("Warning: FBX Files can have messy topology and arent reliable, Use OBJ instead, Are you sure you still want to import this?");
        if (!proceed) return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const modelData = {
            label, color, fileName: file.name,
            fileData: e.target.result,
            extension: extension,
            timestamp: Date.now()
        };
        const transaction = db.transaction(["models"], "readwrite");
        transaction.objectStore("models").add(modelData);
        transaction.oncomplete = () => {
            renderDashboard();
            loadModelToScene(modelData);
            fileInput.value = "";
            document.getElementById('assetLabel').value = "";
            updateFileUI();
        };
    };

    if (extension === 'obj') reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
}

function clearAllAssets() {
    if (!confirm("Are you sure? This will permanently delete your entire library.")) return;
    const transaction = db.transaction(["models"], "readwrite");
    transaction.objectStore("models").clear();
    transaction.oncomplete = () => {
        if (currentModel) { scene.remove(currentModel); currentModel = null; }
        renderDashboard();
    };
}

function fetchFromDB(id) {
    db.transaction(["models"], "readonly").objectStore("models").get(id).onsuccess = (e) => loadModelToScene(e.target.result);
}

function deleteAsset(e, id) {
    e.stopPropagation();
    const transaction = db.transaction(["models"], "readwrite");
    transaction.objectStore("models").delete(id);
    transaction.oncomplete = () => {
        if (currentModel) { scene.remove(currentModel); currentModel = null; }
        renderDashboard();
    };
}

function exportBackup() {
    db.transaction(["models"], "readonly").objectStore("models").getAll().onsuccess = (e) => {
        const blob = new Blob([JSON.stringify(e.target.result)], {type: "application/json"});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `Backup_${Date.now()}.json`;
        a.click();
    };
}

function importBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const imported = JSON.parse(ev.target.result);
            const tx = db.transaction(["models"], "readwrite");
            imported.forEach(item => { delete item.id; tx.objectStore("models").add(item); });
            tx.oncomplete = () => renderDashboard();
        };
        reader.readAsText(e.target.files[0]);
    };
    input.click();
}

function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();
    renderer.render(scene, camera);
}

function updateFileUI() {
    const input = document.getElementById('fileInput');
    const label = document.getElementById('file-text');
    if (input.files.length > 0) label.innerText = input.files[0].name;
}

window.onresize = () => {
    const container = document.getElementById('viewer');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
};

// 1. WIREFRAME TOGGLE
function toggleWireframe() {
    if (!currentModel) return;
    currentModel.traverse(n => {
        if (n.isMesh) {
            n.material.wireframe = !n.material.wireframe;
        }
    });
}

// 2. CLEAR ALL ASSETS
function clearAllAssets() {
    if (!confirm("Are you sure? This will permanently delete all stored assets.")) return;
    
    const transaction = db.transaction(["models"], "readwrite");
    const store = transaction.objectStore("models");
    store.clear();
    
    transaction.oncomplete = () => {
        if (currentModel) {
            scene.remove(currentModel);
            currentModel = null;
        }
        renderDashboard();
        alert("Library cleared.");
    };
}

// 3. UPDATED RENDER DASHBOARD (Restoring Rename/Download UI)
function renderDashboard() {
    const query = document.getElementById('searchBar').value.toLowerCase();
    const list = document.getElementById('assetList');
    if (!db) return;

    const store = db.transaction(["models"], "readonly").objectStore("models");
    store.getAll().onsuccess = (e) => {
        list.innerHTML = e.target.result
            .filter(a => a.label.toLowerCase().includes(query))
            .map(a => `
                <div class="asset-card" onclick='fetchFromDB(${a.id})'>
                    <button class="del-btn" onclick="deleteAsset(event, ${a.id})">✕</button>
                    <strong>${a.label}</strong><br>
                    <small style="opacity:0.5">${a.fileName}</small>
                    <div class="btn-row" style="margin-top:10px;">
                        <button class="secondary-btn" style="font-size:10px; padding:5px;" onclick="event.stopPropagation(); renameAsset(${a.id})">Rename</button>
                        <button class="secondary-btn" style="font-size:10px; padding:5px;" onclick="event.stopPropagation(); downloadMesh(${a.id})">Download</button>
                    </div>
                    <div class="color-bar" style="background:${a.color}"></div>
                </div>
            `).join('');
    };
}