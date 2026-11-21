(function tributeStorageModule(){

    const DEFAULT_SEED_CARDS = [
      {
        id: 'seed-1',
        treeSide: 'left',
        teacherName: 'Thầy Nguyễn Văn Minh • GVCN',
        message: 'Cảm ơn Thầy đã luôn kiên nhẫn chỉ bảo từng bài học và truyền cho chúng em ngọn lửa đam mê tri thức!',
        senderName: 'Tập thể lớp 12A1',
        createdAt: 1732000001000
      },
      {
        id: 'seed-2',
        treeSide: 'right',
        teacherName: 'Cô Trần Thị Thu Hà • Tổ Ngữ Văn',
        message: 'Kính chúc Cô ngày 20/11 thật nhiều sức khỏe, niềm vui và mãi giữ nụ cười rạng rỡ trên bục giảng!',
        senderName: 'Nguyễn Hoàng Nam (K44)',
        createdAt: 1732000002000
      }
    ];

    const state = {
      ready: false,
      user: null,
      db: null,
      appId: typeof __app_id !== 'undefined' ? __app_id : 'tri-an-20-11-app',
      cards: [...DEFAULT_SEED_CARDS],
      freeUsed: 0,
      extraCredits: 0
    };

    function restoreLocalTributes() {
      try {
        const saved = JSON.parse(localStorage.getItem('tribute20-11-local-v2') || '{}');
        state.freeUsed = Number(saved.freeUsed) || 0;
        state.extraCredits = 0;
        state.cards = Array.isArray(saved.cards) ? [...saved.cards, ...DEFAULT_SEED_CARDS] : [...DEFAULT_SEED_CARDS];
      } catch (e) {
        console.warn('Dữ liệu offline không hợp lệ', e);
      }
    }
    function persistLocalTributes() {
      if (state.db && state.user) return;
      try {
        localStorage.setItem('tribute20-11-local-v2', JSON.stringify({
          freeUsed: state.freeUsed,
          cards: state.cards.filter(c => !String(c.id).startsWith('seed-'))
        }));
      } catch (e) { console.warn('Bộ nhớ thiết bị không lưu được', e); }
    }
    function notifyCardsUpdated() {
      if (typeof window.onTributeCardsUpdated === 'function') {
        window.onTributeCardsUpdated(state.cards, {
          freeUsed: state.freeUsed,
          extraCredits: state.extraCredits
        });
      }
    }

    async function initCloudStorage() {
      try {
        if (typeof __firebase_config === 'undefined' || !__firebase_config) {
          restoreLocalTributes();
          state.ready = true;
          notifyCardsUpdated();
          return;
        }
        // Firebase is loaded only if the owner supplies a real configuration.
        const [appMod, authMod, firestoreMod] = await Promise.all([
          import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js'),
          import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js'),
          import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js')
        ]);
        const { initializeApp } = appMod;
        const { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } = authMod;
        const { getFirestore, doc, getDoc, setDoc, addDoc, onSnapshot, collection } = firestoreMod;
        const firebaseConfig = JSON.parse(__firebase_config);
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        state.db = db;

        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }

        await new Promise((resolve) => {
          const unsub = onAuthStateChanged(auth, (u) => {
            if (u) {
              state.user = u;
              unsub();
              resolve();
            }
          });
        });

        if (!state.user) return;

        const quotaRef = doc(db, 'artifacts', state.appId, 'users', state.user.uid, 'wallet', 'tribute_quota');
        const quotaSnap = await getDoc(quotaRef);
        if (quotaSnap.exists()) {
          const d = quotaSnap.data();
          state.freeUsed = Number(d.freeUsed || 0);
          state.extraCredits = Number(d.extraCredits || 0);
        } else {
          await setDoc(quotaRef, { freeUsed: 0, extraCredits: 0 });
        }

        const publicCardsCol = collection(db, 'artifacts', state.appId, 'public', 'data', 'tribute_cards_302');
        onSnapshot(
          publicCardsCol,
          (snapshot) => {
            const loaded = [];
            snapshot.forEach((docSnap) => {
              loaded.push({ id: docSnap.id, ...docSnap.data() });
            });
            loaded.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            state.cards = loaded.length > 0 ? loaded : [...DEFAULT_SEED_CARDS];
            notifyCardsUpdated();
          },
          () => {
            notifyCardsUpdated();
          }
        );

        state.ready = true;
        notifyCardsUpdated();
      } catch (err) {
        console.warn('Không kết nối được Firebase; chuyển sang chế độ lưu trên thiết bị.', err);
        restoreLocalTributes();
        state.ready = true;
        notifyCardsUpdated();
      }
    }

    window.TributeCloud = {
      getSnapshot() {
        return {
          cards: state.cards,
          freeUsed: state.freeUsed,
          extraCredits: state.extraCredits
        };
      },
      canWriteCard() {
        return state.freeUsed < 2 || state.extraCredits > 0;
      },
      async addTributeCard({ treeSide, teacherName, message, senderName }) {
        if (!this.canWriteCard()) {
          return { ok: false, reason: 'PAYMENT_REQUIRED' };
        }
        if (state.freeUsed < 2) {
          state.freeUsed += 1;
        } else if (state.extraCredits > 0) {
          state.extraCredits -= 1;
        }
        const newCard = {
          treeSide: treeSide || 'left',
          teacherName,
          message,
          senderName,
          authorUid: state.user ? state.user.uid : 'guest',
          createdAt: Date.now()
        };
        if (state.db && state.user) {
          const publicCardsCol = collection(state.db, 'artifacts', state.appId, 'public', 'data', 'tribute_cards_302');
          await addDoc(publicCardsCol, newCard);
          const quotaRef = doc(state.db, 'artifacts', state.appId, 'users', state.user.uid, 'wallet', 'tribute_quota');
          await setDoc(quotaRef, { freeUsed: state.freeUsed, extraCredits: state.extraCredits }, { merge: true });
        } else {
          state.cards = [{ id: `local-${Date.now()}`, ...newCard }, ...state.cards];
          persistLocalTributes();
          notifyCardsUpdated();
        }
        return { ok: true };
      },
      async purchaseExtraCardSlot() {
        // Chỉ server đáng tin cậy + webhook thanh toán mới được cộng lượt.
        return false;
      }
    };

    initCloudStorage();
})();

    if (typeof THREE === 'undefined' || !THREE.OrbitControls) {
      document.addEventListener('DOMContentLoaded',()=>{
        const h=document.getElementById('canvas-container');
        if(h) h.innerHTML='<div style="position:absolute;inset:0;display:grid;place-items:center;padding:25px;color:#fff;text-align:center;background:#090f1b;font:600 16px/1.6 sans-serif">Không tải được thư viện 3D (Three.js). Vui lòng kết nối Internet và tải lại trang.</div>';
      });
      throw new Error('Three.js / OrbitControls chưa sẵn sàng: cần Internet để tải CDN');
    }
    // =========================================================================
    // 1. GLOBAL STATE & DATA
    // =========================================================================
    let scene, camera, renderer, clock;
    let controls;
    let hemiLight, sunLight, fillLight;
    let sceneMode = 'intro';
    let currentBuildingSide = 'teacher'; // 'teacher' (Tòa Xanh) | 'female' (Tòa Hồng)
    let isFirstPersonPOV = false; // Mặc định góc nhìn rộng trong phòng để thấy trọn người & đồ đạc; bấm "Nhân Vật" để bật góc nhìn thứ nhất 360°
    let fpYaw = Math.PI;
    let fpPitch = -0.04;
    let isPointerDragging = false;
    let lastPointerX = 0;
    let lastPointerY = 0;

    let interactiveList = [];
    let lastExitedDoorX = 0;
    let hallwaySpawn = null;
    let hallwayEntryAnim = null;
    const TEXTURE_CACHE = {};
    const PBR_MAT_CACHE = {};

    const campusGroup = new THREE.Group();
    const hallwayGroup = new THREE.Group();
    const classroomGroup = new THREE.Group();
    const hallway2Group = new THREE.Group();
    const auditoriumGroup = new THREE.Group();
    const hallway3Group = new THREE.Group();
    const floor3RoomGroup = new THREE.Group();

    let campusFlags = [];
    let campusGardenBeds = [];
    let campusClouds = [];
    let campusWaterRipples = [];
    let graphicsUltra = true;
    let atmosphereMotes = null;
    let skyShaderUniforms = null;
    let campusBirds = [];
    let fountainWaterJets = [];
    let room101BoardMesh = null;
    let room101SavedWishes = [];
    let ceilingFans = [];
    let scooterWheels = [];
    let campusScooterGroup = null;
    let campusHero = null;
    let scooterRiderMesh = null;
    let roomHero = null;
    // One real Object3D persists from the scooter to both buildings,
    // every corridor and the gifting ceremony. Never create a duplicate hero.
    let protagonist = null;
    const PROTAGONIST_ID = 'twenty_november_student_01';
    const PROTAGONIST_APPEARANCE = Object.freeze({
      gender: 'male', role: 'student',
      shirtColor: 0xf8fafc, pantsColor: 0x1e293b,
      hairColor: 0x18181b, skinColor: 0xf8d0b8,
      hasBouquet: true, isSeated: false,
      keepOriginalAppearance: true
    });
    let floatingPetals = [];
    let activeIdleCharacters = [];

    let campusDismountAnim = null;
    let campusEnterBuildingAnim = null;
    let classroomWalkAnim = null;
    let exitRoomWalkAnim = null;
    let stairClimbAnim = null;
    let room101GiftAnim = null;
    let room301GiftAnim = null;

    let room101Teacher = null;
    let room101SeatedStudents = [];
    let room102Teacher = null;
    let room102SlideMesh = null;
    let room102SlideState = null;
    let room102SlidePointer = null;
    let slideIgnoreClickUntil = 0;
    let currentSlideIdx = 0;
    let currentAnthologyBookIdx = 0;
    let currentAnthologyPageIdx = 0;
    let anthologyTurning = false;
    let room103Reader = null;
    let room103ReaderBook = null;
    let room103PageTurn = null;
    let room103LastAutoTurn = 0;
    let anthologySwipeStart = null;

    let room201Performers = [];
    let room201Audience = [];
    let room202State = { waitingStudents: [], reporter: null, interviewee: null };
    let room301Teacher = null;
    let room302Trees = { left: null, right: null };
    let selectedTributeTreeSide = 'left';

    let pinkDecorThemeIdx = 0;
    let pinkRoom101Students = [];
    let pinkRoom201Teachers = [];
    let pink301HangCount = 0;
    let pink301ActiveTab = 'photo';
    let pink301PendingDataURL = null;
    let pink301Frames = [];
    let pink302SelectedItem = 'flower';
    let pink302TableGroup = null;
    let pink302PlacedCount = 0;

    const keysPressed = {};
    let interiorColliders = [];
    const heroVelocity = new THREE.Vector3();
    const cameraState = {
      overview: { position: new THREE.Vector3(), target: new THREE.Vector3() },
      overviewScene: null,
      lastPovYaw: Math.PI,
      movingCam: false
    };
    let transitionLock = false;
    let audioEnabled = true;
    let lastSpeechText = '';
    let speechPlaying = false;
    let giftBloom = null;
    let povHands = null;
    let povBouquet = null;
    const smooth01 = (v) => { const t = THREE.MathUtils.clamp(v, 0, 1); return t * t * (3 - 2 * t); };
    const easeInOut = (v) => { const t = THREE.MathUtils.clamp(v, 0, 1); return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2; };

    function setSceneCurtain(on) {
      const el = document.getElementById('scene-curtain');
      if (el) el.classList.toggle('is-active', !!on);
    }

    // Fine geometric edge highlights are intentionally reserved for hard
    // architectural parts: desks, shelves, book covers, staircase nosings.
    // Applying them to skin/curved shapes would create unnatural outlines.
    const PRECISION_EDGE_MATERIALS = new Map();
    function addPrecisionEdge(mesh,color=0x344054,opacity=0.25) {
      if(!mesh?.geometry || !THREE.EdgesGeometry)return;
      const key=color+'_'+opacity;
      let material=PRECISION_EDGE_MATERIALS.get(key);
      if(!material){
        material=new THREE.LineBasicMaterial({
          color,transparent:true,opacity,depthTest:true,depthWrite:false,
          toneMapped:false
        });
        PRECISION_EDGE_MATERIALS.set(key,material);
      }
      const edges=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry,28),material);
      edges.scale.setScalar(1.0025);
      edges.userData.cinematicOnly=true;
      edges.visible=graphicsUltra;
      edges.renderOrder=2;
      mesh.add(edges);
    }

    function createSceneClearancePlanner(roomWidth=14, roomDepth=12) {
      const reserved=[];
      const intersects=(a,b)=>a.minX<b.maxX && a.maxX>b.minX && a.minZ<b.maxZ && a.maxZ>b.minZ;
      function footprint(x,z,w,d,padding=0.12) {
        return {minX:x-w/2-padding,maxX:x+w/2+padding,
                minZ:z-d/2-padding,maxZ:z+d/2+padding};
      }
      function allowed(box) {
        const inset=0.25;
        return box.minX>=-roomWidth/2+inset && box.maxX<=roomWidth/2-inset &&
               box.minZ>=-roomDepth/2+inset && box.maxZ<=roomDepth/2-inset &&
               !reserved.some(item=>intersects(box,item.box));
      }
      function reserve(label,x,z,w,d,padding=0.12) {
        const box=footprint(x,z,w,d,padding);
        if(!allowed(box))console.warn('[Layout clearance]',label,'is close to another fixture');
        reserved.push({label,box});
        return {x,z};
      }
      function find(label,x,z,w,d,padding=0.12,maxDisplacement=1.15) {
        const orig=footprint(x,z,w,d,padding);
        if(allowed(orig)){reserved.push({label,box:orig});return {x,z};}
        for(let radius=0.16;radius<=maxDisplacement;radius+=0.16){
          for(let a=0;a<16;a++){
            const angle=2*Math.PI*a/16;
            const nx=x+Math.cos(angle)*radius,nz=z+Math.sin(angle)*radius;
            const box=footprint(nx,nz,w,d,padding);
            if(allowed(box)){reserved.push({label,box});return {x:nx,z:nz};}
          }
        }
        console.warn('[Layout clearance] no safe position for',label);
        return null; // Do not silently place an overlapping object.
      }
      return {reserve,find,footprints:reserved};
    }

    function registerCollider(x, z, width, depth, padding = 0.26) {
      interiorColliders.push({ minX: x - width/2 - padding, maxX: x + width/2 + padding,
                               minZ: z - depth/2 - padding, maxZ: z + depth/2 + padding });
    }

    function avatarCanOccupy(x, z) {
      const b = SCENE_CAMERA_BOUNDS[sceneMode] || SCENE_CAMERA_BOUNDS.room101;
      // Scene bounds are camera guides, not the actual walls.
      const hall = sceneMode.startsWith('hallway');
      const w = hall ? 12.48 : ({room201:7.65, room301:7.0, room302:7.3}[sceneMode] || 6.35);
      const d = hall ? 3.00 : ({room201:6.5, room301:6.0, room302:5.9}[sceneMode] || 5.35);
      if (Math.abs(x) > w || Math.abs(z) > d) return false;
      return !interiorColliders.some(c => x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ);
    }

    function resetHeroMotion() {
      heroVelocity.set(0,0,0);
      if (roomHero?.userData) roomHero.userData.walkBlend = 0;
    }

    function activeTransition() {
      return transitionLock || !!(campusDismountAnim || classroomWalkAnim || exitRoomWalkAnim || stairClimbAnim || hallwayEntryAnim || room101GiftAnim || room301GiftAnim || campusEnterBuildingAnim);
    }


    const SCENE_CAMERA_BOUNDS = {
      intro: { minX: -28, maxX: 28, minY: 1.5, maxY: 28, minZ: -12, maxZ: 64, minDist: 4, maxDist: 48 },
      campus: { minX: -28, maxX: 28, minY: 1.5, maxY: 28, minZ: -14, maxZ: 48, minDist: 4, maxDist: 44 },
      hallway: { minX: -12.0, maxX: 12.0, minY: 0.9, maxY: 3.35, minZ: -2.8, maxZ: 3.1, minDist: 0.8, maxDist: 7.5 },
      room101: { minX: -6.3, maxX: 6.3, minY: 0.9, maxY: 3.4, minZ: -5.3, maxZ: 5.3, minDist: 0.8, maxDist: 9.2 },
      room102: { minX: -6.3, maxX: 6.3, minY: 0.9, maxY: 3.4, minZ: -5.3, maxZ: 5.3, minDist: 0.8, maxDist: 9.2 },
      room103: { minX: -6.3, maxX: 6.3, minY: 0.9, maxY: 3.4, minZ: -5.3, maxZ: 5.3, minDist: 0.8, maxDist: 9.2 },
      hallway2: { minX: -12.0, maxX: 12.0, minY: 0.9, maxY: 3.35, minZ: -2.8, maxZ: 3.1, minDist: 0.8, maxDist: 7.5 },
      room201: { minX: -8.6, maxX: 8.6, minY: 0.95, maxY: 4.35, minZ: -7.5, maxZ: 7.5, minDist: 1.0, maxDist: 13.5 },
      room202: { minX: -6.8, maxX: 6.8, minY: 0.9, maxY: 3.55, minZ: -5.8, maxZ: 5.8, minDist: 0.8, maxDist: 9.8 },
      hallway3: { minX: -12.0, maxX: 12.0, minY: 0.9, maxY: 3.35, minZ: -2.8, maxZ: 3.1, minDist: 0.8, maxDist: 7.5 },
      room301: { minX: -6.8, maxX: 6.8, minY: 0.9, maxY: 3.5, minZ: -5.8, maxZ: 5.8, minDist: 0.8, maxDist: 9.8 },
      room302: { minX: -7.8, maxX: 7.8, minY: 0.9, maxY: 3.9, minZ: -6.4, maxZ: 6.4, minDist: 0.8, maxDist: 11.2 }
    };

    const SLIDE_PAGES = [
      {
        title: 'CHÀO MỪNG NGÀY NHÀ GIÁO VIỆT NAM 20/11',
        body: '“Tôn sư trọng đạo” — Truyền thống quý báu ngàn đời của dân tộc Việt Nam. Kính chúc Quý Thầy Cô luôn mạnh khỏe và hạnh phúc!'
      },
      {
        title: 'NGƯỜI LÁI ĐÒ THẦM LẶNG TRÊN DÒNG SÔNG TRI THỨC',
        body: 'Mỗi trang giáo án, mỗi nét phấn trắng là biết bao tâm huyết Thầy Cô gửi trao để chắp cánh cho bao thế hệ học trò bay xa.'
      },
      {
        title: 'KÝ ỨC MÁI TRƯỜNG & BỤI PHẤN THÂN THƯƠNG',
        body: 'Dẫu mai này khôn lớn trưởng thành đi khắp muôn phương, hình bóng Thầy Cô và những giờ giảng ấm áp mãi khắc ghi trong tim.'
      },
      {
        title: 'LỜI HỨA CHĂM NGOAN — HỌC TỐT DÂNG THẦY CÔ',
        body: 'Tập thể học sinh xin nguyện nỗ lực rèn đức luyện tài, gặt hái thật nhiều bông hoa điểm tốt để kính dâng lên Quý Thầy Cô!'
      }
    ];

    const GALLERY_ARTWORKS = [
      {
        title: 'Người Lái Đò Thầm Lặng',
        desc: 'Bức sơn dầu khắc họa con đò tri thức vượt sóng sớm hôm đưa bao thế hệ học trò cập bến tương lai.',
        bg: '#0369a1',
        accent: '#fde047',
        sceneType: 'ferry'
      },
      {
        title: 'Bụi Phấn Trên Bục Giảng',
        desc: 'Ánh nắng ban mai soi rọi trang giáo án và những nét phấn trắng miệt mài vì tương lai học trò.',
        bg: '#065f46',
        accent: '#6ee7b7',
        sceneType: 'classroom'
      },
      {
        title: 'Mùa Hoa Tri Ân 20/11',
        desc: 'Những đóa hoa tươi thắm kết từ lòng biết ơn chân thành của học trò gửi tới Quý Thầy Cô.',
        bg: '#9f1239',
        accent: '#fda4af',
        sceneType: 'gratitude_moment'
      },
      {
        title: 'Ngọn Hải Đăng Tri Thức',
        desc: 'Thầy Cô như ngọn hải đăng soi sáng con đường học vấn và nhân cách cho tuổi trẻ.',
        bg: '#1e3a8a',
        accent: '#93c5fd',
        sceneType: 'lighthouse'
      },
      {
        title: 'Sân Trường Mùa Phượng Vĩ',
        desc: 'Ký ức tuổi học trò dưới tán phượng hồng rực rỡ cùng những lời dặn dò ân cần của Thầy Cô.',
        bg: '#7c2d12',
        accent: '#fdba74',
        sceneType: 'schoolyard'
      },
      {
        title: 'Chắp Cánh Ước Mơ Bay Xa',
        desc: 'Hành trang kiến thức và tình thương của Thầy Cô giúp học trò tự tin chinh phục chân trời mới.',
        bg: '#4c1d95',
        accent: '#ddd6fe',
        sceneType: 'field_trip'
      }
    ];

    const ANTHOLOGY_BOOKS = [
      {
        name: 'Tập San 1: Bụi Phấn & Mùa Hoa',
        pages: [
          {
            title: 'Lời Ngỏ Ngày 20/11',
            body: 'Tháng Mười Một lại về mang theo những cơn gió se lạnh đầu đông và hơi ấm của ngày Hội Tri Ân.\nTập san này là tiếng lòng mộc mạc nhưng chân thành nhất của chúng em gửi tới Quý Thầy Cô.',
            author: 'Ban Biên Tập Chi Đoàn 12A1'
          },
          {
            title: 'Bàn Tay Người Thầy',
            body: 'Bàn tay Thầy cầm viên phấn trắng\nViết lên bảng xanh bao ước mơ hồng\nDẫu mái tóc điểm thêm màu sương muối\nVẫn ân cần dìu dắt bước em đi.',
            author: 'Minh Anh — Lớp 11A2'
          },
          {
            title: 'Cảm Ơn Cô Đã Tin Em',
            body: 'Có những lúc em vấp ngã và muốn bỏ cuộc, chính ánh mắt hiền từ và lời động viên của Cô đã giúp em đứng dậy mạnh mẽ hơn.',
            author: 'Hoàng Nam — Lớp 12A4'
          }
        ]
      },
      {
        name: 'Tập San 2: Người Lái Đò Thầm Lặng',
        pages: [
          {
            title: 'Chuyến Đò Không Mỏi',
            body: 'Năm tháng trôi qua, bao chuyến đò đã cập bến thành công, chỉ có người lái đò vẫn lặng lẽ bên bến sông xưa đón những lứa học trò mới.',
            author: 'Tập Thể Lớp 10A1'
          },
          {
            title: 'Trang Giáo Án Đêm Khuya',
            body: 'Ánh đèn bàn vẫn sáng qua khung cửa sổ khi phố đã ngủ yên — đó là lúc Thầy Cô miệt mài soạn từng bài giảng hay.',
            author: 'Khánh Linh — Lớp 11B1'
          }
        ]
      },
      {
        name: 'Tập San 3: Ước Mơ Tuổi Học Trò',
        pages: [
          {
            title: 'Hạt Mầm Tri Thức',
            body: 'Mỗi lời giảng của Thầy Cô là một hạt mầm yêu thương gieo vào tâm hồn tuổi trẻ, để một ngày nở hoa thơm trái ngọt cho đời.',
            author: 'CLB Văn Học Trẻ'
          },
          {
            title: 'Mãi Nhớ Ơn Thầy Cô',
            body: 'Dù mai sau đi khắp năm châu bốn bể, hai tiếng “Thầy ơi, Cô ơi!” vẫn luôn là thanh âm thiêng liêng nhất.',
            author: 'Cựu Học Sinh Khóa 44'
          }
        ]
      },
      {
        name: 'Tập San 4: Ngọn Hải Đăng Tri Thức',
        pages: [
          {
            title: 'Ánh Sáng Dẫn Đường',
            body: 'Giữa biển lớn tri thức mênh mông, Thầy Cô chính là ngọn hải đăng kiên định chỉ lối cho con thuyền tuổi trẻ cập bến bình yên.',
            author: 'Chi Đoàn 12A3'
          },
          {
            title: 'Bài Học Làm Người',
            body: 'Thầy Cô không chỉ dạy chúng em công thức toán học hay vần thơ hay, mà còn dạy cách sống tử tế và biết yêu thương.',
            author: 'Tuấn Kiệt — Lớp 11A5'
          }
        ]
      },
      {
        name: 'Tập San 5: Ký Ức Mái Trường',
        pages: [
          {
            title: 'Góc Sân Trường Thân Yêu',
            body: 'Hàng ghế đá, tán phượng già và tiếng trống trường rộn rã mãi gắn liền với nụ cười hiền hậu của Quý Thầy Cô.',
            author: 'Tập Thể Lớp 12A2'
          },
          {
            title: 'Lời Chúc 20/11 Trọn Vẹn',
            body: 'Kính chúc Quý Thầy Cô luôn bình an, sức khỏe dồi dào và mãi tự hào về những thế hệ học trò của mình!',
            author: 'Đoàn Trường THPT'
          }
        ]
      }
    ];

    const ROOM301_PHOTOS = [
      {
        title: 'Khoảnh Khắc Tri Ân Trên Bục Giảng',
        desc: 'Bức ảnh lưu giữ nụ cười rạng rỡ của Thầy Cô khi đón nhận những đóa hoa tươi thắm từ học trò nhân ngày 20/11.',
        bg: '#0369a1',
        accent: '#fde047',
        sceneType: 'gratitude_moment'
      },
      {
        title: 'Tiết Học Ngoại Khóa Đáng Nhớ',
        desc: 'Chuyến đi thực tế đầy ắp tiếng cười và những bài học sinh động ngoài trang sách dưới sự hướng dẫn tận tình của Thầy Cô.',
        bg: '#065f46',
        accent: '#6ee7b7',
        sceneType: 'outdoor_class'
      },
      {
        title: 'Lễ Khai Giảng Mùa Thu Năm Ấy',
        desc: 'Tiếng trống khai trường vang vọng mở đầu một năm học mới với bao hoài bão và lời dặn dò ân cần.',
        bg: '#9f1239',
        accent: '#fda4af',
        sceneType: 'schoolyard'
      },
      {
        title: 'Hội Diễn Văn Nghệ Chào Mừng 20/11',
        desc: 'Những tiết mục hát múa tự biên tự diễn đầy cảm xúc của học sinh thay lời cảm ơn gửi tới Quý Thầy Cô.',
        bg: '#4c1d95',
        accent: '#ddd6fe',
        sceneType: 'lighthouse'
      },
      {
        title: 'Giờ Ôn Thi Mùa Hạ',
        desc: 'Những buổi chiều Thầy Cô kiên nhẫn ở lại phụ đạo từng bài toán khó, tiếp thêm tự tin cho học trò trước kỳ thi lớn.',
        bg: '#1e3a8a',
        accent: '#93c5fd',
        sceneType: 'classroom'
      },
      {
        title: 'Ngày Hội Trở Về Mái Trường Xưa',
        desc: 'Các thế hệ cựu học sinh hội tụ bên Thầy Cô, ôn lại kỷ niệm đẹp dưới mái trường thân yêu.',
        bg: '#7c2d12',
        accent: '#fdba74',
        sceneType: 'ferry'
      }
    ];

    const BUILDING_THEMES = {
      teacher: {
        buildingName: 'Tri Ân Thầy Cô Giáo (Tòa Xanh)',
        shortName: 'Tòa Xanh',
        wallAccentHex: 0xe0f2fe,
        signBg: '#0c4a6e',
        signBorder: '#38bdf8',
        teacherGender: 'male',
        teacherShirt: 0x1e3a8a
      },
      female: {
        buildingName: 'Sự Kiện 20-11 (Tòa Hồng)',
        shortName: 'Tòa Hồng',
        wallAccentHex: 0xfce7f3,
        signBg: '#831843',
        signBorder: '#f472b6',
        teacherGender: 'female',
        teacherShirt: 0xbe185d
      }
    };

    function getActiveBuildingTheme() {
      return BUILDING_THEMES[currentBuildingSide] || BUILDING_THEMES.teacher;
    }

    // The eye-level camera has its own visible hands/bouquet, not the full body
    // (which would otherwise occlude the lens when the avatar is hidden).
    function buildPOVViewmodel() {
      if (!camera || povHands) return;
      const armSkin = new THREE.MeshStandardMaterial({ color: 0xf8d0b8, roughness: 0.6 });
      const sleeve = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
      povHands = new THREE.Group();
      camera.add(povHands);
      const addHand = (x, side) => {
        const sleeveMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.072,0.083,0.35,14),sleeve);
        sleeveMesh.rotation.x=-0.83;
        sleeveMesh.rotation.z=side*0.18;
        sleeveMesh.position.set(x,-0.43,-0.44);
        povHands.add(sleeveMesh);
        const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.055,0.25,14),armSkin);
        forearm.rotation.x=-0.94;
        forearm.position.set(x*0.86,-0.29,-0.65);
        povHands.add(forearm);
        const palm = new THREE.Mesh(new THREE.SphereGeometry(0.064,16,12),armSkin);
        palm.scale.set(0.85,1.15,0.85);
        palm.position.set(x*0.74,-0.20,-0.79);
        povHands.add(palm);
      };
      addHand(-0.43,-1); addHand(0.43,1);
      povBouquet = createFlowerBouquet();
      povBouquet.scale.set(1.35,1.35,1.35);
      povBouquet.position.set(0.28,-0.18,-0.88);
      povBouquet.rotation.set(-0.36,0,-0.18);
      povHands.add(povBouquet);
      povHands.visible = false;
    }

    function updatePOVViewmodel(elapsed) {
      if (!povHands) return;
      const active = isFirstPersonPOV && roomHero && sceneMode !== 'campus' && sceneMode !== 'intro';
      povHands.visible = !!active;
      if (!active) return;
      const g=room101GiftAnim || room301GiftAnim;
      const reach=g ? smooth01((g.progress-0.48)/0.25)*(1-smooth01((g.progress-0.78)/0.15)) : 0;
      const step=roomHero.userData.walkBlend||0;
      povHands.position.set(0, reach*0.11+Math.sin(elapsed*8)*0.006*step, -reach*0.19);
      if(povBouquet) povBouquet.visible=!!roomHero.userData.bouquetMesh?.visible;
    }

    let sharedAudioContext = null;
    function playChime(freq = 520, duration = 0.14) {
      if (!audioEnabled) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!sharedAudioContext) sharedAudioContext = new AC();
        if (sharedAudioContext.state === 'suspended') sharedAudioContext.resume();
        const t = sharedAudioContext.currentTime;
        const osc = sharedAudioContext.createOscillator();
        const gain = sharedAudioContext.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.3, t + duration * 0.65);
        const v = speechPlaying ? 0.018 : 0.055;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(v, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        osc.connect(gain); gain.connect(sharedAudioContext.destination);
        osc.start(t); osc.stop(t + duration + 0.01);
      } catch (e) { console.warn('Audio chime:', e); }
    }

    function speakVietnamese(text, onComplete = null) {
      lastSpeechText = String(text || '').trim();
      const done = () => { speechPlaying = false; if (typeof onComplete === 'function') onComplete(); };
      if (!audioEnabled || !lastSpeechText || !('speechSynthesis' in window)) { done(); return false; }
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(lastSpeechText);
        const voices = window.speechSynthesis.getVoices();
        const vn = voices.find(v => /^vi[-_]/i.test(v.lang)) || voices.find(v => /viet/i.test(v.name));
        if (vn) u.voice = vn;
        u.lang = 'vi-VN'; u.rate = 0.88; u.pitch = 1.01; u.volume = 1;
        let completed = false;
        u.onstart = () => { speechPlaying = true; };
        u.onend = u.onerror = () => { if (!completed) { completed = true; done(); } };
        window.speechSynthesis.speak(u);
        // The user already initiated the ceremony by clicking; only start speaking at the proper stage.
        window.speechSynthesis.resume();
        return true;
      } catch (e) { console.warn('Thuyết minh:', e); done(); return false; }
    }

    function updateHeaderStatus(title) {
      const el = document.getElementById('ui-scene-title');
      if (el) el.textContent = title;
    }

    function updatePOVButtonUI() {
      const whole = document.getElementById('btn-camera-overview');
      const pov = document.getElementById('btn-camera-donor');
      if (whole) { whole.classList.toggle('camera-active', !isFirstPersonPOV); whole.setAttribute('aria-pressed', String(!isFirstPersonPOV)); }
      if (pov) { pov.classList.toggle('camera-active', isFirstPersonPOV); pov.setAttribute('aria-pressed', String(isFirstPersonPOV)); }
      if (roomHero && sceneMode !== 'campus' && sceneMode !== 'intro') roomHero.visible = !isFirstPersonPOV;
    }

    function setClassroomControls(items) {
      const box = document.getElementById('classroom-controls');
      if (!box) return;
      box.innerHTML = '';
      if (!items || items.length === 0) {
        box.classList.add('hidden');
        return;
      }
      box.classList.remove('hidden');
      items.forEach((item) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'glass-panel hover:bg-slate-800/90 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition active:scale-95 border border-white/15';
        btn.textContent = item.label;
        btn.addEventListener('click', item.onClick);
        box.appendChild(btn);
      });
    }

    function showSpeechCard(speaker, text) {
      const card = document.getElementById('speech-card');
      const spEl = document.getElementById('speech-speaker');
      const txEl = document.getElementById('speech-text');
      if (!card || !spEl || !txEl) return;
      spEl.textContent = speaker;
      txEl.textContent = text;
      card.classList.remove('hidden');
    }

    function hideSpeechCard() {
      const card = document.getElementById('speech-card');
      if (card) card.classList.add('hidden');
    }

    // =========================================================================
    // 2. LIGHTING, SKY DOME, PMREM ENVIRONMENT & PROCEDURAL PBR TEXTURES
    // =========================================================================
    function configureLightingForMode(mode) {
      if (!hemiLight || !sunLight || !fillLight) return;
      const outdoor = mode === 'intro' || mode === 'campus';
      if(outdoor) {
        hemiLight.intensity=0.53;
        sunLight.intensity=0.90;
        fillLight.intensity=0.19;
        scene.fog = new THREE.FogExp2(0xcbdde9,graphicsUltra?0.0027:0.0034);
        renderer.toneMappingExposure=0.85;
      } else {
        hemiLight.intensity=0.50;
        sunLight.intensity=0.62;
        fillLight.intensity=0.21;
        scene.fog = new THREE.FogExp2(0xf1f5f9,0.0029);
        renderer.toneMappingExposure=0.88;
      }
      // Shadow texels are distributed where the user actually stands.
      // The previous 72m-wide frustum made classroom edges visibly pixelated.
      const extent=outdoor?44:17;
      const sh=sunLight.shadow;
      sh.camera.left=-extent;sh.camera.right=extent;
      sh.camera.top=extent;sh.camera.bottom=-extent;
      sh.camera.near=1;sh.camera.far=outdoor?125:82;
      sh.camera.updateProjectionMatrix();
      sh.normalBias=outdoor?0.014:0.009;
      sh.bias=-0.00016;
      sh.radius=graphicsUltra?1.3:1.15;
      renderer.shadowMap.needsUpdate=true;
    }

    function createSkyDomeAndEnvMap() {
      const skyGeo = new THREE.SphereGeometry(180, 40, 32);
      skyShaderUniforms = {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0.45, 0.62, 0.42).normalize() },
        uTopColor: { value: new THREE.Color(0x174b70) },
        uMidColor: { value: new THREE.Color(0x79badb) },
        uHorizonColor: { value: new THREE.Color(0xc9dfe9) },
        uSunColor: { value: new THREE.Color(0xfffbeb) }
      };

      const skyMat = new THREE.ShaderMaterial({
        uniforms: skyShaderUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: `
          varying vec3 vWorldPos;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPos = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform vec3 uSunDir;
          uniform vec3 uTopColor;
          uniform vec3 uMidColor;
          uniform vec3 uHorizonColor;
          uniform vec3 uSunColor;
          varying vec3 vWorldPos;
          void main() {
            vec3 dir = normalize(vWorldPos);
            float h = clamp(dir.y, 0.0, 1.0);
            vec3 col = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.28, h));
            col = mix(col, uTopColor, smoothstep(0.24, 0.85, h));

            float sunAmt = max(dot(dir, uSunDir), 0.0);
            float halo = pow(sunAmt, 12.0) * 0.045 + pow(sunAmt, 80.0) * 0.085;
            float disc = smoothstep(0.9988, 0.9997, sunAmt) * 0.17;
            col += uSunColor * (halo + disc);

            float mist = sin(dir.x * 7.0 + uTime * 0.18) * cos(dir.z * 7.0 - uTime * 0.14) * 0.025 * (1.0 - h);
            col += vec3(mist);
            gl_FragColor = vec4(col, 1.0);
          }
        `
      });
      const skyDome = new THREE.Mesh(skyGeo, skyMat);
      scene.add(skyDome);

      const envTex = makeCanvasTexture('sky_env_grad', 512, 512, (ctx, w, h) => {
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0.0, '#0284c7');
        grad.addColorStop(0.45, '#38bdf8');
        grad.addColorStop(0.78, '#bae6fd');
        grad.addColorStop(1.0, '#fef3c7');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      });

      if (renderer && THREE.PMREMGenerator) {
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envScene = new THREE.Scene();
        const envMesh = new THREE.Mesh(
          new THREE.SphereGeometry(40, 24, 16),
          new THREE.MeshBasicMaterial({ map: envTex, side: THREE.BackSide })
        );
        envScene.add(envMesh);
        const envRT = pmrem.fromScene(envScene, 0.035);
        scene.environment = envRT.texture;
        pmrem.dispose();
      }
    }

    function makeCanvasTexture(key, w, h, drawFn) {
      if (TEXTURE_CACHE[key]) return TEXTURE_CACHE[key];
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      drawFn(ctx, w, h);
      const tex = new THREE.CanvasTexture(canvas);
      tex.encoding = THREE.sRGBEncoding;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      if (renderer && renderer.capabilities) {
        tex.anisotropy = Math.min(graphicsUltra ? 16 : 6, renderer.capabilities.getMaxAnisotropy());
      }
      TEXTURE_CACHE[key] = tex;
      return tex;
    }

    // V8 material pipeline: high-resolution albedo, independent tangent normals
    // and roughness; cached to avoid duplicate canvases and GPU textures.
    function getProceduralPBRMaterial(type, baseHex=0xffffff, roughness=0.5, metalness=0.05, repeat=2) {
      const cacheKey=['pbr3',type,baseHex,roughness,metalness,repeat].join('_');
      if(PBR_MAT_CACHE[cacheKey])return PBR_MAT_CACHE[cacheKey];
      const wood=type==='wood', stone=type==='tile'||type==='stone';
      const baseCss=typeof baseHex==='number'?'#'+baseHex.toString(16).padStart(6,'0'):new THREE.Color(baseHex).getStyle();
      // Mobile / low-memory GPUs receive the same physically correct material
      // at reduced texel density, avoiding out-of-memory and WebGL resets.
      const lowMemory=(navigator.deviceMemory&&navigator.deviceMemory<=4)
        ||Math.min(window.innerWidth,window.innerHeight)<680;
      const dim=graphicsUltra?(lowMemory?512:768):384;
      const micro=graphicsUltra?(lowMemory?256:384):192;
      let seed=0x9e3779b9;
      for(let i=0;i<cacheKey.length;i++)seed=Math.imul(seed^cacheKey.charCodeAt(i),0x45d9f3b);
      function rand(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;}
      const diffuse=makeCanvasTexture('color3_'+cacheKey,dim,dim,(ctx,w,h)=>{
        ctx.fillStyle=baseCss;ctx.fillRect(0,0,w,h);
        if(wood){
          for(let y=0;y<h;y+=2){
            const wave=0.06+Math.sin(y*0.035+Math.sin(y*0.008)*2)*0.046;
            ctx.fillStyle='rgba(27,15,6,'+Math.max(0.018,wave)+')';
            ctx.fillRect(0,y,w,1+Math.floor(rand()*2));
            if(rand()<0.3){ctx.fillStyle='rgba(255,248,221,0.075)';ctx.fillRect(0,y+1,w,1);}
          }
          for(let i=1;i<4;i++){
            const y=i*h/4;
            ctx.strokeStyle='rgba(25,15,6,0.26)';ctx.lineWidth=3;
            ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();
            ctx.strokeStyle='rgba(255,244,213,0.18)';ctx.lineWidth=1;
            ctx.beginPath();ctx.moveTo(0,y+4);ctx.lineTo(w,y+4);ctx.stroke();
          }
          for(let i=0;i<3;i++){
            const x=rand()*w,y=rand()*h;
            for(let ring=0;ring<5;ring++){
              ctx.beginPath();ctx.ellipse(x,y,6+ring*7,3+ring*4,0,0,Math.PI*2);
              ctx.strokeStyle='rgba(33,20,9,'+(0.19-ring*0.027)+')';
              ctx.lineWidth=1.5;ctx.stroke();
            }
          }
        } else if(stone){
          const n=type==='tile'?3:2, tw=w/n;
          for(let y=0;y<n;y++)for(let x=0;x<n;x++){
            const xx=x*tw,yy=y*tw;
            const white=rand()>0.5;
            ctx.fillStyle=white?'rgba(255,255,255,0.028)':'rgba(18,30,42,0.025)';
            ctx.fillRect(xx+3,yy+3,tw-6,tw-6);
            ctx.strokeStyle='rgba(32,44,56,0.28)';ctx.lineWidth=4;
            ctx.strokeRect(xx+2,yy+2,tw-4,tw-4);
            ctx.strokeStyle='rgba(255,255,255,0.20)';ctx.lineWidth=1;
            ctx.strokeRect(xx+6,yy+6,tw-12,tw-12);
          }
          for(let i=0;i<w*h/270;i++){
            ctx.fillStyle=rand()<0.48?'rgba(15,23,42,0.065)':'rgba(255,255,255,0.10)';
            const r=1+rand()*2;ctx.fillRect(rand()*w,rand()*h,r,r);
          }
        } else if(type==='brick'){
          const rh=h/12,rw=w/6;
          ctx.strokeStyle='rgba(250,248,235,0.40)';ctx.lineWidth=3;
          for(let y=0;y<12;y++){
            const yy=y*rh;ctx.beginPath();ctx.moveTo(0,yy);ctx.lineTo(w,yy);ctx.stroke();
            for(let x=-1;x<7;x++){
              const xx=(x+0.5*(y%2))*rw;
              ctx.beginPath();ctx.moveTo(xx,yy);ctx.lineTo(xx,yy+rh);ctx.stroke();
            }
          }
        } else if(type==='roof'){
          const band=h/13;
          for(let y=0;y<13;y++){
            const yy=y*band,g=ctx.createLinearGradient(0,yy,0,yy+band);
            g.addColorStop(0,'rgba(255,255,255,0.16)');
            g.addColorStop(1,'rgba(16,26,37,0.24)');
            ctx.fillStyle=g;ctx.fillRect(0,yy,w,band);
            ctx.strokeStyle='rgba(16,25,33,0.34)';ctx.lineWidth=2;
            ctx.beginPath();ctx.moveTo(0,yy+band);ctx.lineTo(w,yy+band);ctx.stroke();
            for(let x=0;x<w;x+=w/11){
              ctx.beginPath();ctx.arc(x+w/22,yy+band*0.18,w/22,0,Math.PI);ctx.stroke();
            }
          }
        } else if(type==='grass'){
          for(let i=0;i<w*h/125;i++){
            const r=rand();
            ctx.strokeStyle=r>0.67?'rgba(249,242,187,0.17)':r>0.33?'rgba(9,77,40,0.25)':'rgba(255,255,255,0.10)';
            ctx.lineWidth=0.7+rand();
            const x=rand()*w,y=rand()*h;
            ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+rand()*2-1,y-3-rand()*8);ctx.stroke();
          }
        }
      });
      // Height is generated in linear grayscale, NOT sampled from the sRGB albedo.
      // Convert local gradients to a proper RGB tangent-space normal map.
      const normalCanvas=document.createElement('canvas');
      normalCanvas.width=micro;normalCanvas.height=micro;
      const c=normalCanvas.getContext('2d'),height=new Uint8Array(micro*micro);
      for(let y=0;y<micro;y++)for(let x=0;x<micro;x++){
        const noise=Math.sin(x*0.13+y*0.07)+0.35*Math.sin(y*0.39-x*0.29);
        const grain=wood?Math.sin(y*0.38+x*0.017)*0.4:0;
        const sections=stone?(type==='tile'?3:2):0;
        const grout=sections && (x%(micro/sections)<2 || y%(micro/sections)<2) ? -42:0;
        height[y*micro+x]=Math.max(0,Math.min(255,128+noise*20+grain*17+grout+(rand()-0.5)*14));
      }
      const pixels=c.createImageData(micro,micro);
      const sample=(x,y)=>height[((y+micro)%micro)*micro+((x+micro)%micro)]/255;
      const factor=wood?0.95:stone?0.75:type==='grass'?1.22:0.8;
      for(let y=0;y<micro;y++)for(let x=0;x<micro;x++){
        const dx=(sample(x+1,y)-sample(x-1,y))*factor;
        const dy=(sample(x,y+1)-sample(x,y-1))*factor;
        const len=Math.hypot(dx,dy,1), i=4*(y*micro+x);
        pixels.data[i]=Math.round(255*(0.5-0.5*dx/len));
        pixels.data[i+1]=Math.round(255*(0.5-0.5*dy/len));
        pixels.data[i+2]=Math.round(255*(0.5+0.5/len));
        pixels.data[i+3]=255;
      }
      c.putImageData(pixels,0,0);
      const normalTex=new THREE.CanvasTexture(normalCanvas);
      const roughTex=makeCanvasTexture('rough3_'+cacheKey,micro,micro,(ctx,w,h)=>{
        ctx.fillStyle='#eeeeee';ctx.fillRect(0,0,w,h);
        for(let i=0;i<w*h/180;i++){
          const shade=Math.round(209+rand()*35);
          ctx.fillStyle='rgb('+shade+','+shade+','+shade+')';
          ctx.fillRect(rand()*w,rand()*h,1+rand()*3,1+rand()*3);
        }
        if(stone){
          const n=type==='tile'?3:2;
          ctx.strokeStyle='#f9f9f9';ctx.lineWidth=2;
          for(let i=0;i<=n;i++){const v=i*w/n;
            ctx.beginPath();ctx.moveTo(v,0);ctx.lineTo(v,h);ctx.stroke();
            ctx.beginPath();ctx.moveTo(0,v);ctx.lineTo(w,v);ctx.stroke();
          }
        }
      });
      [diffuse,normalTex,roughTex].forEach(tex=>{
        tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(repeat,repeat);
        tex.anisotropy=Math.min(graphicsUltra?12:6,renderer?.capabilities?.getMaxAnisotropy?.()||4);
      });
      const material=new THREE.MeshStandardMaterial({
        map:diffuse,normalMap:normalTex,
        normalScale:new THREE.Vector2(0.42,0.42),
        roughnessMap:roughTex,roughness,
        metalness:Math.min(metalness,wood?0.02:type==='grass'?0:0.16),
        envMapIntensity:0.56
      });
      PBR_MAT_CACHE[cacheKey]=material;
      return material;
    }

    function createSignBoard(text, bg='#7f1d1d', border='#facc15', textColor='#fef08a', width=4, height=0.8, isVertical=false) {
      const aspect=Math.max(0.16,width/Math.max(0.15,height));
      const density=graphicsUltra?(Math.min(window.innerWidth,window.innerHeight)<680?1:1.35):1;
      const baseW=isVertical?320:Math.min(1536,Math.max(640,Math.round(330*aspect)));
      const baseH=isVertical?1280:320;
      const cw=Math.round(baseW*density),ch=Math.round(baseH*density);
      const key=['sign8',text,bg,border,textColor,cw,ch,isVertical].join('_');
      const texture=makeCanvasTexture(key,cw,ch,(ctx,w,h)=>{
        ctx.save();ctx.scale(w/baseW,h/baseH);
        ctx.imageSmoothingQuality='high';
        const W=baseW,H=baseH;
        const gradient=ctx.createLinearGradient(0,0,W,H);
        gradient.addColorStop(0,bg);gradient.addColorStop(0.64,bg);gradient.addColorStop(1,'#141d29');
        ctx.fillStyle=gradient;ctx.fillRect(0,0,W,H);
        ctx.strokeStyle=border;ctx.lineWidth=11;ctx.strokeRect(11,11,W-22,H-22);
        ctx.strokeStyle='rgba(255,255,255,0.22)';ctx.lineWidth=2;
        ctx.strokeRect(25,25,W-50,H-50);
        ctx.fillStyle='rgba(255,255,255,0.045)';ctx.fillRect(28,30,W-56,H*0.25);
        ctx.shadowColor='rgba(0,0,0,0.35)';ctx.shadowBlur=3;
        ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=textColor;
        if(isVertical){
          const words=String(text).split(/\s+/).filter(Boolean);
          const step=(H-150)/Math.max(1,words.length);
          const fs=Math.min(63,Math.floor(step*0.69));
          ctx.font='800 '+fs+'px Inter,Arial,sans-serif';
          words.forEach((word,i)=>ctx.fillText(word,W/2,75+(i+0.5)*step,W-44));
        }else{
          let fontSize=Math.round(H*0.28);
          ctx.font='800 '+fontSize+'px Inter,Arial,sans-serif';
          while(ctx.measureText(text).width>W-95 && fontSize>24){
            fontSize-=2;ctx.font='800 '+fontSize+'px Inter,Arial,sans-serif';
          }
          ctx.fillText(text,W/2,H/2+4,W-75);
        }
        ctx.restore();
      });
      const frame=new THREE.Group();
      const metal=new THREE.MeshStandardMaterial({color:0x283443,roughness:0.56,metalness:0.32});
      const back=new THREE.Mesh(new THREE.BoxGeometry(width+0.09,height+0.09,0.10),metal);
      back.castShadow=true;back.receiveShadow=true;frame.add(back);
      const face=new THREE.Mesh(new THREE.PlaneGeometry(width,height),
        new THREE.MeshBasicMaterial({map:texture,toneMapped:false,side:THREE.DoubleSide}));
      face.position.z=0.057;frame.add(face);
      return frame;
    }

    function createArtCanvasDataURL(art) {
      const canvas = document.createElement('canvas');
      // Render art and gallery photo thumbnails at 1.5x native sharpness.
      canvas.width = 960;
      canvas.height = 630;
      const ctx = canvas.getContext('2d');
      ctx.scale(1.5, 1.5);

      const grad = ctx.createLinearGradient(0, 0, 0, 420);
      grad.addColorStop(0, art.bg || '#0369a1');
      grad.addColorStop(0.65, '#1e293b');
      grad.addColorStop(1, '#0f172a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 640, 420);

      const sunGrad = ctx.createRadialGradient(485, 105, 8, 485, 105, 95);
      sunGrad.addColorStop(0, art.accent || '#fde047');
      sunGrad.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = sunGrad;
      ctx.beginPath();
      ctx.arc(485, 105, 95, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      if (art.sceneType === 'ferry') {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.32)';
        ctx.fillRect(0, 235, 640, 185);
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.moveTo(190, 260);
        ctx.lineTo(430, 260);
        ctx.lineTo(395, 290);
        ctx.lineTo(225, 290);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(285, 185, 14, 75);
      } else if (art.sceneType === 'lighthouse') {
        ctx.fillStyle = 'rgba(254, 249, 195, 0.25)';
        ctx.beginPath();
        ctx.moveTo(320, 130);
        ctx.lineTo(640, 50);
        ctx.lineTo(640, 210);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(302, 130, 36, 160);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(302, 175, 36, 32);
      } else if (art.sceneType === 'schoolyard' || art.sceneType === 'outdoor_class') {
        ctx.fillStyle = '#78350f';
        ctx.fillRect(175, 185, 22, 110);
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath();
        ctx.arc(186, 165, 68, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#fef9c3';
        ctx.beginPath();
        ctx.moveTo(320, 240);
        ctx.quadraticCurveTo(250, 210, 195, 232);
        ctx.lineTo(195, 275);
        ctx.quadraticCurveTo(250, 255, 320, 282);
        ctx.quadraticCurveTo(390, 255, 445, 275);
        ctx.lineTo(445, 232);
        ctx.quadraticCurveTo(390, 210, 320, 240);
        ctx.fill();
      }
      ctx.restore();

      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.fillRect(24, 305, 592, 92);
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)';
      ctx.lineWidth = 2;
      ctx.strokeRect(24, 305, 592, 92);

      ctx.fillStyle = '#fef08a';
      ctx.font = '800 26px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(art.title || 'Tri Ân 20/11', 320, 344, 560);

      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = '600 15px Inter, sans-serif';
      ctx.fillText('Triển Lãm Nghệ Thuật Chào Mừng Ngày Nhà Giáo Việt Nam 20/11', 320, 378);

      return canvas.toDataURL('image/png');
    }

    function createContactShadow(radiusX = 0.36, radiusZ = 0.36, opacity = 0.34) {
      const shadowTex = makeCanvasTexture('soft_contact_shadow', 128, 128, (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(2, 6, 23, 0.85)');
        g.addColorStop(0.55, 'rgba(2, 6, 23, 0.32)');
        g.addColorStop(1, 'rgba(2, 6, 23, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      });
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(radiusX * 2, radiusZ * 2),
        new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity, depthWrite: false })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.015;
      return mesh;
    }

    // =========================================================================
    // 3. BOUQUET, REALISTIC HUMAN CHARACTER, FURNITURE & HONDA CUB 81
    // =========================================================================
    function createFlowerBouquet() {
      const group = new THREE.Group();
      const wrapMat = new THREE.MeshStandardMaterial({ color: 0xfda4af, roughness: 0.45, side: THREE.DoubleSide });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.32, 14, 1, true), wrapMat);
      cone.rotation.x = Math.PI;
      cone.position.y = 0.14;
      group.add(cone);

      const ribbon = new THREE.Mesh(
        new THREE.TorusGeometry(0.055, 0.012, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.5 })
      );
      ribbon.rotation.x = Math.PI / 2;
      ribbon.position.y = 0.08;
      group.add(ribbon);

      const leafMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.6 });
      const flowerColors = [0xf43f5e, 0xfacc15, 0xfb7185, 0xf97316, 0xe879f9, 0xffffff];
      for (let i = 0; i < 9; i++) {
        const angle = (i / 9) * Math.PI * 2;
        const r = i === 0 ? 0 : 0.075;
        const bloom = new THREE.Mesh(
          new THREE.SphereGeometry(0.042, 10, 10),
          new THREE.MeshStandardMaterial({ color: flowerColors[i % flowerColors.length], roughness: 0.35 })
        );
        bloom.position.set(Math.cos(angle) * r, 0.3 + (i % 2) * 0.025, Math.sin(angle) * r);
        // Small articulated petals make the bouquet legible at both camera distances.
        const petals = new THREE.Group();
        petals.position.copy(bloom.position);
        const petalMat = new THREE.MeshStandardMaterial({color:flowerColors[i % flowerColors.length],roughness:0.38,side:THREE.DoubleSide});
        for(let j=0;j<5;j++) {
          const a=j*Math.PI*2/5;
          const petal=new THREE.Mesh(new THREE.SphereGeometry(0.029,8,6),petalMat);
          petal.scale.set(0.74,0.33,1.3);
          petal.position.set(Math.cos(a)*0.027,0.006,Math.sin(a)*0.027);
          petal.rotation.y=a;
          petals.add(petal);
        }
        const center=new THREE.Mesh(new THREE.SphereGeometry(0.016,8,6),
          new THREE.MeshStandardMaterial({color:0xffe69a,roughness:0.64}));
        center.position.y=0.018;petals.add(center);
        group.add(petals);

        if (i % 2 === 0) {
          const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 8), leafMat);
          leaf.scale.set(1.4, 0.4, 0.8);
          leaf.position.set(Math.cos(angle) * 0.11, 0.26, Math.sin(angle) * 0.11);
          group.add(leaf);
        }
      }
      return group;
    }

    function createFlowerVase(vaseColor = 0x0284c7) {
      const group = new THREE.Group();
      const vaseMat = new THREE.MeshPhysicalMaterial({ color: vaseColor, roughness: 0.18, metalness: 0.12, clearcoat: 0.85 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.06, 14), vaseMat);
      base.position.y = 0.03;
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.095, 14, 14), vaseMat);
      body.scale.set(1, 1.35, 1);
      body.position.y = 0.14;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.09, 14), vaseMat);
      neck.position.y = 0.26;
      group.add(base, body, neck);

      const bouquet = createFlowerBouquet();
      bouquet.scale.set(0.75, 0.75, 0.75);
      bouquet.position.y = 0.24;
      group.add(bouquet);
      return group;
    }

    function createPottedIndoorPlant(scale = 1) {
      const group = new THREE.Group();
      group.scale.set(scale, scale, scale);
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.19, 0.36, 16),
        getProceduralPBRMaterial('stone', 0xf8fafc, 0.35)
      );
      pot.position.y = 0.18;
      pot.castShadow = true;
      group.add(pot);

      const soil = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.24, 0.04, 16),
        new THREE.MeshStandardMaterial({ color: 0x3f2305, roughness: 0.92 })
      );
      soil.position.y = 0.35;
      group.add(soil);

      const leafMat1 = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.62 });
      const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.55 });
      for (let i = 0; i < 7; i++) {
        const ang = (i / 7) * Math.PI * 2;
        const stem = new THREE.Mesh(
          new THREE.CylinderGeometry(0.015, 0.022, 0.45 + (i % 3) * 0.12, 8),
          leafMat1
        );
        stem.position.set(Math.cos(ang) * 0.07, 0.55, Math.sin(ang) * 0.07);
        stem.rotation.z = -Math.cos(ang) * 0.25;
        stem.rotation.x = Math.sin(ang) * 0.25;
        group.add(stem);

        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), i % 2 === 0 ? leafMat1 : leafMat2);
        leaf.scale.set(1.25, 0.32, 0.75);
        leaf.position.set(Math.cos(ang) * 0.18, 0.74 + (i % 3) * 0.1, Math.sin(ang) * 0.18);
        leaf.rotation.y = ang;
        group.add(leaf);
      }
      group.add(createContactShadow(0.3, 0.3, 0.28));
      return group;
    }

    function createBookshelfWithBooks(accentColor = 0x0284c7) {
      const group = new THREE.Group();
      const woodMat = getProceduralPBRMaterial('wood', 0x78350f, 0.42, 0.08, 2);
      const backPanel = new THREE.Mesh(new THREE.BoxGeometry(1.45, 2.1, 0.06), woodMat);
      backPanel.position.set(0, 1.05, -0.18);
      group.add(backPanel);

      [-0.7, 0.7].forEach((sx) => {
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.1, 0.42), woodMat);
        side.position.set(sx, 1.05, 0);
        side.castShadow = true;
        group.add(side);
      });

      const bookColors = [accentColor, 0xdc2626, 0xfacc15, 0x16a34a, 0x7c3aed, 0xea580c, 0x0ea5e9];
      [0.06, 0.56, 1.06, 1.56, 2.06].forEach((sy, shelfIdx) => {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.05, 0.4), woodMat);
        shelf.position.set(0, sy, 0);
        group.add(shelf);

        if (shelfIdx < 4) {
          for (let b = 0; b < 9; b++) {
            const bh = 0.28 + ((b + shelfIdx) % 3) * 0.05;
            const book = new THREE.Mesh(
              new THREE.BoxGeometry(0.11, bh, 0.26),
              new THREE.MeshStandardMaterial({ color: bookColors[(b + shelfIdx * 2) % bookColors.length], roughness: 0.42 })
            );
            book.position.set(-0.52 + b * 0.13, sy + 0.025 + bh / 2, 0.02);
            group.add(book);
          }
        }
      });
      return group;
    }

    function createStudentDeskAndChair(hasBooks=true,hasChair=true) {
      // V9.3: school desk with physical frame and two correctly placed chairs.
      // Dimensions and chair centers stay unchanged to preserve seated poses,
      // player collisions and room layout.
      const group=new THREE.Group();
      const oak=getProceduralPBRMaterial('wood',0xb8783d,0.53,0.01,1.6);
      const darkOak=getProceduralPBRMaterial('wood',0x865b3b,0.62,0.01,1.5);
      const frame=new THREE.MeshStandardMaterial({color:0x49525c,metalness:0.62,roughness:0.41});
      const screws=new THREE.MeshStandardMaterial({color:0xb2bdc8,metalness:0.85,roughness:0.28});
      const black=new THREE.MeshStandardMaterial({color:0x303740,roughness:0.86});
      const blue=new THREE.MeshStandardMaterial({color:0x315f9c,roughness:0.63});
      function box(parent,w,h,d,x,y,z,mat,highlight=false){
        const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
        m.position.set(x,y,z);
        m.castShadow=true;m.receiveShadow=true;
        parent.add(m);
        if(highlight)addPrecisionEdge(m,0x4e321c,0.18);
        return m;
      }
      // Full wood desktop: thin laminate band, two long inset edges.
      box(group,1.56,0.052,0.64,0,0.747,0,oak,true);
      box(group,1.55,0.013,0.65,0,0.715,0,darkOak);
      box(group,1.54,0.018,0.033,0,0.725,0.299,oak);
      box(group,1.54,0.018,0.03,0,0.725,-0.299,oak);
      // A thin steel rail under the worktop makes the frame readable.
      box(group,1.47,0.031,0.031,0,0.670,0.249,frame);
      box(group,1.47,0.031,0.031,0,0.670,-0.249,frame);
      // Under-table book shelf and modesty panel, clear of the knee space.
      box(group,1.38,0.027,0.43,0,0.575,0.015,darkOak);
      box(group,1.41,0.28,0.026,0,0.497,-0.273,darkOak);
      for(const lx of [-0.696,0.696]){
        for(const lz of [-0.242,0.242]){
          box(group,0.043,0.71,0.043,lx,0.359,lz,frame);
          box(group,0.061,0.046,0.058,lx,0.021,lz,black);
        }
        box(group,0.045,0.034,0.49,lx,0.455,0,frame);
      }
      // Two stationery compartments provide detail without additional textures.
      if(hasBooks){
        for(const [x,col,rot] of [[-0.36,blue,0.10],[0.33,oak,-0.11]]){
          const book=box(group,0.275,0.03,0.205,x,0.791,0.025,col);
          book.rotation.y=rot;
          box(group,0.20,0.008,0.012,x,0.811,0.06,screws);
        }
        box(group,0.012,0.018,0.27,-0.02,0.796,-0.10,blue);
      }
      if(hasChair){
        for(const cx of [-0.38,0.38]){
          const chair=new THREE.Group();
          chair.position.set(cx,0,0.46);
          // Chair seat centers exactly match the pupils at dz+0.46.
          box(chair,0.425,0.047,0.415,0,0.443,0,oak,true);
          box(chair,0.39,0.02,0.388,0,0.408,0,frame);
          // Backrest remains just behind the pupil (local +Z).
          box(chair,0.41,0.20,0.032,0,0.772,0.190,oak,true);
          for(const x of [-0.18,0.18]){
            box(chair,0.034,0.44,0.035,x,0.22,-0.158,frame);
            box(chair,0.037,0.82,0.036,x,0.41,0.174,frame);
            box(chair,0.053,0.038,0.055,x,0.018,-0.158,black);
            box(chair,0.055,0.038,0.055,x,0.018,0.174,black);
          }
          group.add(chair);
        }
      }
      group.userData.furnitureType='classroom_desk_double_chair';
      return group;
    }

    function createWoodenBench(width = 1.85) {
      const group = new THREE.Group();
      const woodMat = getProceduralPBRMaterial('wood', 0x92400e, 0.42, 0.08, 2);
      const steelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.75, roughness: 0.28 });

      const seat = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, 0.46), woodMat);
      seat.position.y = 0.46;
      seat.castShadow = true;
      group.add(seat);

      const back = new THREE.Mesh(new THREE.BoxGeometry(width, 0.22, 0.05), woodMat);
      back.position.set(0, 0.78, -0.2);
      back.rotation.x = -0.12;
      group.add(back);

      [-width * 0.42, width * 0.42].forEach((lx) => {
        const legFront = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.46, 0.05), steelMat);
        legFront.position.set(lx, 0.23, 0.18);
        const legBack = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.88, 0.05), steelMat);
        legBack.position.set(lx, 0.44, -0.18);
        group.add(legFront, legBack);
      });
      return group;
    }

    function addRoomWindowsAndCurtains(targetGroup, width = 14, depth = 12, height = 3.8, curtainHex = 0x38bdf8) {
      const wallX = -width / 2 + 0.14;
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.75, roughness: 0.25 });
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xe0f2fe,
        roughness: 0.12,
        metalness: 0.04,
        clearcoat: 0.9,
        envMapIntensity: 0.65,
        transparent: true,
        opacity: 0.24,
        depthWrite: false
      });
      const curtainMat = new THREE.MeshStandardMaterial({ color: curtainHex, roughness: 0.72, side: THREE.DoubleSide });
      const sillMat = getProceduralPBRMaterial('stone', 0xf8fafc, 0.35);

      [-depth * 0.28, 0, depth * 0.28].forEach((wz, idx) => {
        const winGroup = new THREE.Group();
        winGroup.position.set(wallX, height * 0.54, wz);
        winGroup.rotation.y = Math.PI / 2;

        const frame = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.65, 0.1), frameMat);
        winGroup.add(frame);

        const glass = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.45, 0.12), glassMat);
        winGroup.add(glass);

        const mullionV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.48, 0.14), frameMat);
        const mullionH = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.05, 0.14), frameMat);
        winGroup.add(mullionV, mullionH);

        const sill = new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.08, 0.26), sillMat);
        sill.position.set(0, -0.84, 0.08);
        winGroup.add(sill);

        [-0.95, 0.95].forEach((cx) => {
          const drape = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.82, 0.08), curtainMat);
          drape.position.set(cx, 0.02, 0.1);
          winGroup.add(drape);
        });

        if (idx === 1) {
          const miniVase = createFlowerVase(curtainHex);
          miniVase.scale.set(0.65, 0.65, 0.65);
          miniVase.position.set(0, -0.8, 0.1);
          winGroup.add(miniVase);
        }

        targetGroup.add(winGroup);
      });
    }

    function createWallClockAndSlogan(sloganText = 'TÔN SƯ TRỌNG ĐẠO • UỐNG NƯỚC NHỚ NGUỒN', bgHex = '#991b1b') {
      const group = new THREE.Group();
      const clockTex = makeCanvasTexture('classroom_wall_clock', 256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 118, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 12;
        ctx.stroke();
        ctx.fillStyle = '#0f172a';
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(w / 2 + Math.cos(a) * 92, h / 2 + Math.sin(a) * 92, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(w / 2, h / 2);
        ctx.lineTo(w / 2 + 45, h / 2 - 35);
        ctx.stroke();
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(w / 2, h / 2);
        ctx.lineTo(w / 2 - 20, h / 2 - 72);
        ctx.stroke();
      });

      const clockMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 0.06, 24),
        new THREE.MeshBasicMaterial({ map: clockTex })
      );
      clockMesh.rotation.x = Math.PI / 2;
      clockMesh.position.set(3.45, 0.05, 0.075);
      group.add(clockMesh);

      const slogan = createSignBoard(sloganText, bgHex, '#facc15', '#fef08a', 4.6, 0.42);
      slogan.position.set(0, 0.05, 0);
      group.add(slogan);

      return group;
    }

    // Smooth skinned humanoids (CC0) loaded only where animated characters
    // are supported; existing procedural bodies remain as an automatic fallback.
    // Sources: https://tevy.dev/models/casual-walker and /models/hiker
    const AVATAR_ASSETS = {
      male: 'https://tevy.dev/models/casual-walker/v1/',
      female: 'https://tevy.dev/models/hiker/v1/'
    };
    let humanoidLoader = null;
    const humanoidAssetPromises = new Map();
    let enhancedHumanoids = [];

    function getHumanoidLoader() {
      if (humanoidLoader) return humanoidLoader;
      if (!renderer || !THREE.GLTFLoader || !THREE.KTX2Loader ||
          !THREE.SkeletonUtils || !THREE.SkeletonUtils.clone ||
          !window.MeshoptDecoder) return null;
      try {
        const ktx = new THREE.KTX2Loader()
          .setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/basis/')
          .detectSupport(renderer);
        humanoidLoader = new THREE.GLTFLoader();
        humanoidLoader.setKTX2Loader(ktx);
        humanoidLoader.setMeshoptDecoder(window.MeshoptDecoder);
        return humanoidLoader;
      } catch (error) {
        console.warn('GLB avatar decoder unavailable; keeping original human models.', error);
        return null;
      }
    }

    function getEnhancedHumanAsset(gender, highDetail) {
      const loader = getHumanoidLoader();
      if (!loader) return null;
      const url = (AVATAR_ASSETS[gender] || AVATAR_ASSETS.male) + (highDetail ? 'lod0.glb' : 'lod1.glb');
      if (!humanoidAssetPromises.has(url)) {
        humanoidAssetPromises.set(url, new Promise((resolve,reject) => {
          loader.load(url, resolve, undefined, reject);
        }).catch(error => {
          console.warn('Character GLB could not be loaded; procedural fallback retained:', url, error);
          return null;
        }));
      }
      return humanoidAssetPromises.get(url);
    }

    function upgradeStandingHuman(root, options) {
      // Sit animations are a separate rig requirement; do not force a walking
      // avatar onto a chair or it will recreate the distorted-leg bug.
      if (options.isSeated || options.role === 'reader') return;
      const asset = getEnhancedHumanAsset(options.gender, options.role === 'teacher' || options.hasBouquet);
      if (!asset) return;
      asset.then(gltf => {
        // Skip models from previous scenes already torn down by a room switch.
        if (!gltf || !root.parent || !root.userData) return;
        try {
          const body = THREE.SkeletonUtils.clone(gltf.scene);
          const bounds = new THREE.Box3().setFromObject(body);
          const height = bounds.max.y - bounds.min.y;
          const scale = height > 0.5 ? 1.70/height : 1;
          body.scale.setScalar(scale);
          body.position.y = -bounds.min.y*scale;
          body.traverse(obj => {
            if (obj.isMesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
              if (obj.material) {
                // Keep the original material's textures, with restrained shine.
                const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                materials.forEach(mat => {
                  if (mat.roughness !== undefined) mat.roughness = Math.max(0.48, mat.roughness);
                });
              }
              // A backpack is inappropriate in a teacher/student ceremony.
              if (/backpack|rucksack|hiking_pack/i.test(obj.name)) obj.visible=false;
            }
          });
          // Preserve click interactions when switching from procedural to GLB.
          let interaction = null;
          root.traverse(obj => {
            if (!interaction && obj.isMesh && obj.userData.interactiveType) {
              interaction = obj.userData.interactiveType;
            }
          });
          const bouquet = root.userData.bouquetMesh;
          const originalChildren = [...root.children];
          const hand = body.getObjectByName('hand_R') || body.getObjectByName('Hand_R') ||
            body.getObjectByName('RightHand') || body.getObjectByName('mixamorigRightHand');
          if (bouquet) {
            if (hand) {
              hand.add(bouquet);
              bouquet.position.set(0.01, -0.13, 0.065);
              bouquet.rotation.set(-0.4, 0.05, 0.18);
              bouquet.scale.setScalar(0.78);
            } else {
              body.add(bouquet);
              bouquet.position.set(-0.20,1.05,0.26);
              bouquet.rotation.set(-0.3,0,0.1);
              bouquet.scale.setScalar(0.78);
            }
          }
          originalChildren.forEach(child => { if (!child.userData?.keepWithEnhanced) child.visible=false; });
          root.add(body);
          if (interaction) {
            body.traverse(obj => {
              if (!obj.isMesh) return;
              obj.userData.interactiveType=interaction;
              if (root.parent && root.parent.visible) interactiveList.push(obj);
            });
          }

          const mixer = new THREE.AnimationMixer(body);
          const getClip = key => gltf.animations.find(clip => clip.name.toLowerCase() === key);
          const idleClip = getClip('idle');
          const walkClip = getClip('walk');
          const idle = idleClip ? mixer.clipAction(idleClip) : null;
          const walk = walkClip ? mixer.clipAction(walkClip) : null;
          if (idle) { idle.play(); idle.setEffectiveWeight(1); }
          if (walk) { walk.play(); walk.timeScale=1.45; walk.setEffectiveWeight(0); }
          let upperRight=null;
          body.traverse(obj => {
            if (obj.isBone && !upperRight &&
                /(?:upper.?arm.?r|right.?upper.?arm|arm.?upper.?r)/i.test(obj.name)) upperRight=obj;
          });
          root.userData.enhancedBody = body;
          enhancedHumanoids.push({root,mixer,idle,walk,upperRight});
        } catch (error) {
          console.warn('Enhanced avatar failed to initialize; original character kept.', error);
        }
      });
    }

    function updateEnhancedHumanoids(dt) {
      enhancedHumanoids = enhancedHumanoids.filter(item=>!!item.root.parent);
      enhancedHumanoids.forEach(item=>{
        let visible=true, ptr=item.root;
        while(ptr){if(!ptr.visible){visible=false;break;}ptr=ptr.parent;}
        if(!visible) return;
        const weight=THREE.MathUtils.clamp(item.root.userData.walkBlend || 0,0,1);
        if(item.idle) item.idle.setEffectiveWeight(1-weight);
        if(item.walk) item.walk.setEffectiveWeight(weight);
        item.mixer.update(dt);
        // A limited upper-arm gesture tracks the existing bouquet choreography.
        if (item.upperRight && item.root.userData.rightArm) {
          const originalAngle=item.root.userData.rightArm.rotation.x;
          if (Math.abs(originalAngle)>0.22 && weight<0.25) item.upperRight.rotation.x+=originalAngle*0.48;
        }
      });
    }

    function createRealisticHuman(opts = {}) {
      const {
        gender = 'male',
        role = 'student',
        shirtColor = 0xffffff,
        pantsColor = 0x1e293b,
        hairColor = 0x18181b,
        skinColor = 0xf8d0b8,
        hasBouquet = false,
        isSeated = false,
        keepOriginalAppearance = false
      } = opts;

      const root = new THREE.Group();
      root.add(createContactShadow(0.32, 0.32, 0.34));
      const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.62, metalness: 0.0 });
      const shirtMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.66, metalness: 0.02 });
      const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.76, metalness: 0.01 });
      const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.72, metalness: 0.02 });
      const shoeMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.50, metalness: 0.08 });
      const soleMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.58 });
      const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.18, metalness: 0 });
      const irisMat = new THREE.MeshStandardMaterial({ color: 0x241c16, roughness: 0.40, metalness: 0 });
      const lipMat = new THREE.MeshStandardMaterial({ color: 0xbe123c, roughness: 0.52, metalness: 0 });
      const eyelidMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.72, metalness: 0 });

      const hipY = isSeated ? 0.52 : 0.85;

      const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.142, 0.152, 0.16, 18), pantsMat);
      pelvis.scale.set(1.06, 1, 0.86);
      pelvis.position.y = hipY;
      pelvis.castShadow = true;
      root.add(pelvis);

      const torso = new THREE.Mesh(
        new THREE.CylinderGeometry(gender === 'female' ? 0.158 : 0.172, 0.138, 0.46, 20),
        shirtMat
      );
      torso.scale.set(1.06, 1, 0.80);
      torso.position.y = hipY + 0.3;
      torso.castShadow = true;
      root.add(torso);

      [-1, 1].forEach(side => {
        const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.072, 14, 10), shirtMat);
        shoulder.scale.set(0.95, 0.78, 0.82);
        shoulder.position.set(side * 0.17, hipY + 0.475, 0);
        root.add(shoulder);
      });

      const chestCap = new THREE.Mesh(new THREE.SphereGeometry(0.165, 18, 12), shirtMat);
      chestCap.scale.set(1.08, 0.38, 0.80);
      chestCap.position.y = hipY + 0.5;
      root.add(chestCap);

      const collar = new THREE.Mesh(
        new THREE.TorusGeometry(0.082, 0.017, 10, 20),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })
      );
      collar.rotation.x = Math.PI / 2 + 0.12;
      collar.position.set(0, hipY + 0.52, 0.01);
      root.add(collar);

      if (role === 'mc' || role === 'student') {
        const scarf = new THREE.Mesh(
          new THREE.ConeGeometry(0.088, 0.25, 8),
          new THREE.MeshStandardMaterial({ color: role === 'mc' ? 0xdc2626 : 0x2563eb, roughness: 0.45 })
        );
        scarf.rotation.x = Math.PI - 0.1;
        scarf.position.set(0, hipY + 0.39, 0.132);
        root.add(scarf);
      } else if (role === 'teacher') {
        const tie = new THREE.Mesh(
          new THREE.ConeGeometry(0.028, 0.26, 6),
          new THREE.MeshStandardMaterial({ color: gender === 'female' ? 0xfacc15 : 0xdc2626, roughness: 0.35 })
        );
        tie.rotation.x = Math.PI;
        tie.position.set(0, hipY + 0.35, 0.142);
        root.add(tie);
      }

      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.058, 0.12, 16), skinMat);
      neck.position.y = hipY + 0.565;
      root.add(neck);

      const headGroup = new THREE.Group();
      headGroup.position.y = hipY + 0.715;
      root.add(headGroup);

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.152, 24, 24), skinMat);
      head.scale.set(0.9, 1.04, 0.92);
      head.castShadow = true;
      headGroup.add(head);

      [-0.05, 0.05].forEach((ex) => {
        const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.0155, 14, 14), eyeWhiteMat);
        eyeWhite.scale.set(1.1, 0.62, 0.6);
        eyeWhite.position.set(ex, 0.016, 0.136);
        headGroup.add(eyeWhite);

        const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0092, 12, 12), irisMat);
        iris.position.set(ex, 0.016, 0.147);
        headGroup.add(iris);

        const upperLid = new THREE.Mesh(new THREE.BoxGeometry(0.031, 0.007, 0.016), eyelidMat);
        upperLid.position.set(ex, 0.028, 0.138);
        upperLid.rotation.z = ex * -0.4;
        headGroup.add(upperLid);

        const catchlight = new THREE.Mesh(new THREE.SphereGeometry(0.0036, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        catchlight.position.set(ex + 0.003, 0.021, 0.152);
        headGroup.add(catchlight);
      });

      // Ears, subtle eyebrows and nose add readable human anatomy without textures.
      [-1,1].forEach(side => {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.031,12,10),skinMat);
        ear.scale.set(0.48,1,0.67);
        ear.position.set(side*0.149,-0.015,0.008);
        headGroup.add(ear);
        const brow = new THREE.Mesh(new THREE.BoxGeometry(0.039,0.005,0.006),hairMat);
        brow.position.set(side*0.054,0.05,0.139);
        brow.rotation.z=side*.065;
        headGroup.add(brow);
      });
      const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.136, 20, 16), skinMat);
      jaw.scale.set(0.95, 0.52, 0.84);
      jaw.position.set(0, -0.088, 0.01);
      headGroup.add(jaw);

      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.021, 12, 10), skinMat);
      nose.scale.set(0.5, 0.68, 0.98);
      nose.position.set(0, -0.008, 0.148);
      headGroup.add(nose);
      const smile = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0038, 8, 16, Math.PI), lipMat);
      smile.rotation.x = Math.PI;
      smile.position.set(0, -0.05, 0.136);
      headGroup.add(smile);

      const chin = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), skinMat);
      chin.scale.set(0.8, 0.58, 0.7);
      chin.position.set(0, -0.082, 0.115);
      headGroup.add(chin);

      const hairCap = new THREE.Mesh(
        new THREE.SphereGeometry(0.166, 24, 24, 0, Math.PI * 2, 0, Math.PI * 0.67), hairMat
      );
      hairCap.position.set(0, 0.018, -0.008);
      headGroup.add(hairCap);

      const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.038, 0.04), hairMat);
      fringe.position.set(0, 0.082, 0.115);
      fringe.rotation.x = -0.16;
      headGroup.add(fringe);

      if (gender === 'female') {
        const backHair = new THREE.Mesh(new THREE.CylinderGeometry(0.142, 0.17, 0.34, 18), hairMat);
        backHair.position.set(0, -0.085, -0.055);
        headGroup.add(backHair);
        [-1, 1].forEach(side => {
          const sideLock = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.018, 0.18, 10), hairMat);
          sideLock.position.set(side * 0.105, -0.01, 0.085);
          sideLock.rotation.z = side * 0.16;
          sideLock.rotation.x = 0.2;
          headGroup.add(sideLock);
        });

        const hairRibbon = new THREE.Mesh(
          new THREE.BoxGeometry(0.055, 0.028, 0.022),
          new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.35 })
        );
        hairRibbon.position.set(0.11, 0.085, 0.065);
        hairRibbon.rotation.z = -0.35;
        headGroup.add(hairRibbon);
      }

      function buildArm(side) {
        const shoulderPivot = new THREE.Group();
        shoulderPivot.position.set(side * 0.205, hipY + 0.48, 0);

        const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.044, 0.22, 14), shirtMat);
        upperArm.position.y = -0.11;
        shoulderPivot.add(upperArm);

        const lowerPivot = new THREE.Group();
        lowerPivot.position.y = -0.22;
        shoulderPivot.add(lowerPivot);

        const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.032, 0.21, 14), skinMat);
        forearm.position.y = -0.1;
        lowerPivot.add(forearm);

        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.041, 10, 10), skinMat);
        hand.scale.set(0.85, 1.15, 0.65);
        hand.position.y = -0.21;
        lowerPivot.add(hand);

        shoulderPivot.userData.lowerPivot = lowerPivot;
        root.add(shoulderPivot);
        return shoulderPivot;
      }

      const leftArm = buildArm(1);
      const rightArm = buildArm(-1);

      const bouquetMesh = createFlowerBouquet();
      bouquetMesh.position.set(0, -0.22, 0.08);
      bouquetMesh.rotation.x = 0.45;
      bouquetMesh.visible = hasBouquet;
      rightArm.userData.lowerPivot.add(bouquetMesh);

      function buildLeg(side) {
        // Seated legs are modeled directly in local seated coordinates.
        // This avoids stacking opposing 90-degree hip/knee rotations, which
        // could visually detach the knees/feet after the avatar turns toward the desk.
        if (isSeated) {
          const seatedLeg = new THREE.Group();
          seatedLeg.position.set(side * 0.084, hipY - 0.045, 0);

          // Each part meets its neighboring joint: hip -> forward thigh -> knee -> vertical shin -> shoe.
          const hipJoint = new THREE.Mesh(new THREE.SphereGeometry(0.063, 14, 12), pantsMat);
          hipJoint.position.set(0, 0, 0.02);
          seatedLeg.add(hipJoint);

          const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.063, 0.054, 0.32, 16), pantsMat);
          thigh.rotation.x = Math.PI / 2;
          thigh.position.set(0, -0.02, 0.16);
          thigh.castShadow = true;
          seatedLeg.add(thigh);

          const knee = new THREE.Mesh(new THREE.SphereGeometry(0.056, 14, 12), pantsMat);
          knee.position.set(0, -0.04, 0.32);
          knee.castShadow = true;
          seatedLeg.add(knee);

          const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.051, 0.041, 0.34, 16), pantsMat);
          shin.position.set(0, -0.22, 0.32);
          shin.castShadow = true;
          seatedLeg.add(shin);

          const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.108, 0.072, 0.215), shoeMat);
          shoe.position.set(0, -0.39, 0.39);
          shoe.castShadow = true;
          seatedLeg.add(shoe);

          const sole = new THREE.Mesh(new THREE.BoxGeometry(0.114, 0.021, 0.225), soleMat);
          sole.position.set(0, -0.429, 0.394);
          seatedLeg.add(sole);

          root.add(seatedLeg);
          seatedLeg.userData.lowerPivot = seatedLeg;
          return seatedLeg;
        }

        const hipPivot = new THREE.Group();
        hipPivot.position.set(side * 0.084, hipY - 0.04, 0);

        const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.067, 0.056, 0.36, 16), pantsMat);
        thigh.position.y = -0.18;
        thigh.castShadow = true;
        hipPivot.add(thigh);

        const lowerPivot = new THREE.Group();
        lowerPivot.position.y = -0.36;
        hipPivot.add(lowerPivot);

        const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.36, 16), pantsMat);
        shin.position.y = -0.18;
        shin.castShadow = true;
        lowerPivot.add(shin);

        const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.106, 0.072, 0.215), shoeMat);
        shoe.position.set(0, -0.37, 0.042);
        lowerPivot.add(shoe);

        const sole = new THREE.Mesh(new THREE.BoxGeometry(0.112, 0.022, 0.222), soleMat);
        sole.position.set(0, -0.405, 0.045);
        lowerPivot.add(sole);

        hipPivot.userData.lowerPivot = lowerPivot;
        root.add(hipPivot);
        return hipPivot;
      }

      const leftLeg = buildLeg(1);
      const rightLeg = buildLeg(-1);

      if (isSeated) {
        leftArm.rotation.x = -0.45;
        rightArm.rotation.x = -0.45;
      }

      root.userData = { leftLeg, rightLeg, leftArm, rightArm, headGroup, bouquetMesh, isSeated };
      // The same hand-built actor must remain recognizable on the scooter
      // and at the ceremony: other NPCs can still use the external GLB rigs.
      if (!keepOriginalAppearance) upgradeStandingHuman(root, {gender,role,hasBouquet,isSeated});
      return root;
    }

    function getProtagonist() {
      if (!protagonist) {
        protagonist = createRealisticHuman(PROTAGONIST_APPEARANCE);
        protagonist.name = PROTAGONIST_ID;
        protagonist.userData.characterId = PROTAGONIST_ID;
        protagonist.userData.isProtagonist = true;
        protagonist.userData.storyRole = 'The same student who rides to school and presents flowers';
      }
      return protagonist;
    }

    function setProtagonistPose(mode, withBouquet = true) {
      const hero = getProtagonist();
      const data = hero.userData;
      const riding = mode === 'riding';
      data.isRiding = riding;
      data.isSeated = false; // Standing rig's joints can now change pose.
      data.walkBlend = 0;
      data.walkTime = 0;
      [data.leftLeg, data.rightLeg].forEach(hip => {
        if (!hip) return;
        hip.rotation.x = riding ? -1.16 : 0;
        hip.rotation.y = 0;
        hip.rotation.z = 0;
        if (hip.userData.lowerPivot) {
          hip.userData.lowerPivot.rotation.x = riding ? 1.13 : 0;
          hip.userData.lowerPivot.rotation.z = 0;
        }
      });
      if(data.leftArm){
        data.leftArm.rotation.set(riding ? -0.95 : 0, 0, riding ? -0.08 : 0);
        if(data.leftArm.userData.lowerPivot)
          data.leftArm.userData.lowerPivot.rotation.x = riding ? -0.15 : 0;
      }
      if(data.rightArm){
        data.rightArm.rotation.set(riding ? -0.95 : 0, 0, riding ? 0.08 : 0);
        if(data.rightArm.userData.lowerPivot)
          data.rightArm.userData.lowerPivot.rotation.x = riding ? -0.15 : 0;
      }
      if(data.headGroup)data.headGroup.rotation.set(0,0,0);
      if(data.bouquetMesh)data.bouquetMesh.visible = !riding && withBouquet;
      // The same body and clothing persist across all stages.
      return hero;
    }

    function createHondaCubScooter() {
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x0d9488, roughness: 0.24, metalness: 0.35, clearcoat: 0.65 });
      const creamMat = new THREE.MeshPhysicalMaterial({ color: 0xfef9c3, roughness: 0.3, clearcoat: 0.45 });
      const chromeMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.14, metalness: 0.92 });
      const tireMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 });
      const leatherMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.52 });

      const centerSpine = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 1.15, 16), bodyMat);
      centerSpine.rotation.x = Math.PI / 2 - 0.18;
      centerSpine.position.set(0, 0.52, -0.05);
      centerSpine.castShadow = true;
      group.add(centerSpine);

      const rearBody = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.66), bodyMat);
      rearBody.position.set(0, 0.62, 0.26);
      rearBody.castShadow = true;
      group.add(rearBody);

      const legShield = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.68, 0.12), creamMat);
      legShield.position.set(0, 0.68, -0.45);
      legShield.rotation.x = -0.22;
      legShield.castShadow = true;
      group.add(legShield);

      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.13, 0.54), leatherMat);
      seat.position.set(0, 0.85, 0.12);
      group.add(seat);

      const giftBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.28, 0.34),
        new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.35 })
      );
      giftBox.position.set(0, 0.97, 0.58);
      group.add(giftBox);

      const handleBar = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.72, 12), chromeMat);
      handleBar.rotation.z = Math.PI / 2;
      handleBar.position.set(0, 1.08, -0.48);
      group.add(handleBar);

      const headlightLens = new THREE.Mesh(
        new THREE.SphereGeometry(0.112, 14, 14),
        new THREE.MeshStandardMaterial({ color: 0xfef9c3, emissive: 0xfef08a, emissiveIntensity: 0.14 })
      );
      headlightLens.position.set(0, 1.03, -0.62);
      group.add(headlightLens);

      const basket = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 0.25, 0.28),
        getProceduralPBRMaterial('wood', 0xb45309, 0.65)
      );
      basket.position.set(0, 0.84, -0.74);
      group.add(basket);

      [-0.08, 0.08].forEach((bx) => {
        const bq = createFlowerBouquet();
        bq.position.set(bx, 0.99, -0.74);
        bq.scale.set(1.15, 1.15, 1.15);
        group.add(bq);
      });

      const wheels = [];
      [-0.66, 0.64].forEach((wz) => {
        const wheel = new THREE.Group();
        wheel.position.set(0, 0.34, wz);
        const tire = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.068, 12, 24), tireMat);
        tire.rotation.y = Math.PI / 2;
        wheel.add(tire);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.022, 8, 20), chromeMat);
        rim.rotation.y = Math.PI / 2;
        wheel.add(rim);
        group.add(wheel);
        wheels.push(wheel);
      });

      // It is exactly the same actor who will later walk through school.
      // Ride pose changes joints on the existing body; no separate rider mesh.
      const rider = setProtagonistPose('riding', false);
      rider.position.set(0, 0.01, 0.06);
      rider.rotation.y = Math.PI;
      group.add(rider);

      [-0.32, 0.32].forEach((mx) => {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), chromeMat);
        stem.position.set(mx, 1.18, -0.48);
        stem.rotation.z = mx < 0 ? 0.25 : -0.25;
        group.add(stem);
        const mirror = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.02, 14), chromeMat);
        mirror.rotation.x = Math.PI / 2;
        mirror.position.set(mx * 1.15, 1.28, -0.48);
        group.add(mirror);
      });
      const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.95, 12), chromeMat);
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(-0.24, 0.32, 0.28);
      group.add(exhaust);
      group.add(createContactShadow(0.55, 1.05, 0.38));

      return { group, rider, wheels };
    }

    // =========================================================================
    // 4. FLOATING LABELS & PETAL PARTICLES
    // =========================================================================
    function initFloatingPetals() {
      const petalGeo = new THREE.PlaneGeometry(0.14, 0.1);
      const colors = [0xfda4af, 0xfef08a, 0xfbcfe8, 0xffffff];
      for (let i = 0; i < 65; i++) {
        const mat = new THREE.MeshBasicMaterial({
          color: colors[i % colors.length],
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85
        });
        const mesh = new THREE.Mesh(petalGeo, mat);
        mesh.position.set(
          (Math.random() - 0.5) * 44,
          1.2 + Math.random() * 14,
          (Math.random() - 0.5) * 44
        );
        mesh.userData = {
          speedY: 0.45 + Math.random() * 0.55,
          swaySpeed: 1.2 + Math.random() * 1.5,
          phase: Math.random() * Math.PI * 2
        };
        scene.add(mesh);
        floatingPetals.push(mesh);
      }
    }

    // =========================================================================
    // 5. CAMPUS BUILDINGS, RED WELCOME GATE, FOUNTAIN & FLOWER BEDS
    // =========================================================================
    function createCampusSchoolBuilding({ side, mainColor, trimColor, roofColor, titleText }) {
      const isFemale = side === 'female';
      const outDir = isFemale ? -1 : 1;
      const frontFaceX = outDir * 5.2;
      const bGroup = new THREE.Group();

      const plinth = new THREE.Mesh(
        new THREE.BoxGeometry(11.4, 0.55, 16.4),
        getProceduralPBRMaterial('stone', 0xcbd5e1, 0.45)
      );
      plinth.position.y = 0.275;
      plinth.receiveShadow = true;
      bGroup.add(plinth);

      const wallMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.48 });
      const accentMat = new THREE.MeshStandardMaterial({ color: mainColor, roughness: 0.38 });
      const trimMat = new THREE.MeshStandardMaterial({ color: trimColor, roughness: 0.32 });
      const goldMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.78, roughness: 0.24 });
      const roofMat = getProceduralPBRMaterial('roof', roofColor, 0.42, 0.16, 4);
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xbae6fd,
        emissive: isFemale ? 0xfce7f3 : 0xe0f2fe,
        emissiveIntensity: 0.08,
        roughness: 0.08,
        metalness: 0.18,
        clearcoat: 0.85,
        transparent: true,
        opacity: 0.78
      });
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.78, roughness: 0.24 });

      const body = new THREE.Mesh(new THREE.BoxGeometry(10.4, 10.6, 15.6), wallMat);
      body.position.y = 5.85;
      body.castShadow = true;
      body.receiveShadow = true;
      bGroup.add(body);

      [-7.5, -2.6, 2.6, 7.5].forEach((pz) => {
        const pilaster = new THREE.Mesh(new THREE.BoxGeometry(10.75, 10.6, 0.58), accentMat);
        pilaster.position.set(0, 5.85, pz);
        bGroup.add(pilaster);
      });

      [4.0, 7.5, 11.1].forEach((by) => {
        const band = new THREE.Mesh(new THREE.BoxGeometry(11.15, 0.32, 16.25), trimMat);
        band.position.y = by;
        bGroup.add(band);

        const goldStrip = new THREE.Mesh(new THREE.BoxGeometry(11.2, 0.07, 16.3), goldMat);
        goldStrip.position.y = by + 0.17;
        bGroup.add(goldStrip);
      });

      [2.3, 5.7, 9.2].forEach((wy, floorIdx) => {
        [-5.1, 0, 5.1].forEach((wz) => {
          if (floorIdx === 0 && wz === 0) return;
          const winFrame = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.68, 2.24), frameMat);
          winFrame.position.set(frontFaceX, wy, wz);
          bGroup.add(winFrame);

          const winGlass = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.46, 2.02), glassMat);
          winGlass.position.set(frontFaceX, wy, wz);
          bGroup.add(winGlass);

          const sill = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 2.42), trimMat);
          sill.position.set(frontFaceX + outDir * 0.08, wy - 0.86, wz);
          bGroup.add(sill);

          const louver = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 2.42), accentMat);
          louver.position.set(frontFaceX + outDir * 0.12, wy + 0.88, wz);
          bGroup.add(louver);
        });
      });

      const roof = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.75, 16.8), roofMat);
      roof.position.y = 11.55;
      roof.castShadow = true;
      bGroup.add(roof);

      const cupola = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.8, 3.2), accentMat);
      cupola.position.y = 12.6;
      bGroup.add(cupola);

      const cupolaDome = new THREE.Mesh(
        new THREE.ConeGeometry(2.5, 1.4, 4),
        goldMat
      );
      cupolaDome.rotation.y = Math.PI / 4;
      cupolaDome.position.y = 14.15;
      bGroup.add(cupolaDome);

      [-1.55, 1.55].forEach((cz) => {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 3.3, 16), wallMat);
        col.position.set(frontFaceX + outDir * 1.15, 2.15, cz);
        col.castShadow = true;
        bGroup.add(col);
      });
      const porticoRoof = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.28, 3.85), trimMat);
      porticoRoof.position.set(frontFaceX + outDir * 0.75, 3.85, 0);
      bGroup.add(porticoRoof);

      const frontSignX = frontFaceX + outDir * 0.28;
      const signBoard = createSignBoard(
        titleText,
        isFemale ? '#831843' : '#0c4a6e',
        isFemale ? '#f472b6' : '#38bdf8',
        '#ffffff',
        8.6,
        0.92
      );
      signBoard.rotation.y = isFemale ? -Math.PI / 2 : Math.PI / 2;
      signBoard.position.set(frontSignX, 10.6, 0);
      bGroup.add(signBoard);

      const doorType = isFemale ? 'enter_female_bldg' : 'enter_teacher_bldg';
      for (let s = 0; s < 3; s++) {
        const step = new THREE.Mesh(
          new THREE.BoxGeometry(0.45, 0.17, 4.4 - s * 0.25),
          getProceduralPBRMaterial('stone', 0xe2e8f0, 0.4)
        );
        step.position.set(frontFaceX + outDir * (0.28 + s * 0.42), 0.42 - s * 0.16, 0);
        step.userData = { interactiveType: doorType };
        bGroup.add(step);
      }

      // V9.2: three-dimensional school entrance with structural reveals,
      // bronze mullions, tinted glass, inset kick plates and paired pull bars.
      // Old version put the glass on top of an opaque door block.
      const portalFrame = new THREE.MeshStandardMaterial({
        color:isFemale?0x51404c:0x344455,roughness:0.39,metalness:0.48
      });
      const bronze = new THREE.MeshStandardMaterial({
        color:isFemale?0xd2aa91:0xb5a88a,roughness:0.33,metalness:0.74
      });
      const doorTint=new THREE.MeshPhysicalMaterial({
        color:isFemale?0xcad8e6:0xbddce9,metalness:0.05,roughness:0.14,
        transparent:true,opacity:0.71,depthWrite:false,
        clearcoat:0.56,side:THREE.DoubleSide
      });
      const doorKick=new THREE.MeshStandardMaterial({
        color:isFemale?0x786171:0x566f7e,metalness:0.16,roughness:0.55
      });
      const darkEntrance=new THREE.MeshStandardMaterial({
        color:0x192b37,roughness:0.8,metalness:0.05
      });
      const outerX=frontFaceX+outDir*0.20;
      const addDoorPart=(group,w,h,d,x,y,z,mat,interactive=false)=>{
        const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
        mesh.position.set(x,y,z);
        mesh.castShadow=mat!==doorTint;
        mesh.receiveShadow=true;
        if(interactive)mesh.userData.interactiveType=doorType;
        group.add(mesh);
        return mesh;
      };
      // This dark inset makes the doorway read as depth even against the
      // existing solid building shell (no disruptive wall CSG required).
      addDoorPart(bGroup,0.07,3.06,2.45,frontFaceX+outDir*0.105,2.035,0,darkEntrance);
      [-1.24,1.24].forEach(zz=>{
        addDoorPart(bGroup,0.23,3.12,0.15,outerX,2.06,zz,portalFrame);
        addDoorPart(bGroup,0.258,2.96,0.025,outerX+outDir*0.025,2.06,zz*0.96,bronze);
      });
      addDoorPart(bGroup,0.25,0.135,2.59,outerX,3.56,0,portalFrame);
      addDoorPart(bGroup,0.26,0.055,2.52,outerX+outDir*0.02,3.47,0,bronze);
      addDoorPart(bGroup,0.44,0.07,2.38,outerX+outDir*0.12,0.53,0,bronze);
      // Vertical glass-door wings, swinging about the original hinges.
      function makeEntranceWing(left){
        const sign=left?1:-1;
        const hinge=new THREE.Group();
        hinge.position.set(frontFaceX+outDir*0.275,0.5,left?-1.18:1.18);
        const centerZ=sign*0.575;
        for(const lx of [-0.048,0.048]){
          addDoorPart(hinge,0.037,2.84,0.095,lx,1.47,sign*0.061,portalFrame,true);
          addDoorPart(hinge,0.037,2.84,0.095,lx,1.47,sign*1.087,portalFrame,true);
          addDoorPart(hinge,0.037,0.09,1.14,lx,2.85,centerZ,portalFrame,true);
          addDoorPart(hinge,0.037,0.08,1.14,lx,0.86,centerZ,portalFrame,true);
          addDoorPart(hinge,0.04,0.037,1.12,lx,2.04,centerZ,bronze,true);
        }
        // Different panes and the base panel never occupy the same space.
        addDoorPart(hinge,0.026,1.89,1.03,0,1.90,centerZ,doorTint,true);
        addDoorPart(hinge,0.074,0.75,1.03,0,0.412,centerZ,doorKick,true);
        addDoorPart(hinge,0.085,0.12,1.05,outDir*0.018,0.12,centerZ,bronze,true);
        // Fine specular highlight strips imply layered glass at an angle.
        addDoorPart(hinge,0.014,1.72,0.028,outDir*0.06,1.92,sign*0.18,
          new THREE.MeshBasicMaterial({color:0xf4ffff,transparent:true,opacity:0.19,depthWrite:false}));
        const handleZ=sign*1.003;
        const handleX=outDir*0.175;
        for(const y of [1.30,1.80]){
          addDoorPart(hinge,0.175,0.05,0.08,handleX-outDir*0.075,y,handleZ,bronze,true);
        }
        const grip=new THREE.Mesh(new THREE.CylinderGeometry(0.027,0.027,0.65,14),bronze);
        grip.position.set(handleX,1.55,handleZ);
        grip.castShadow=true;
        grip.userData.interactiveType=doorType;
        hinge.add(grip);
        bGroup.add(hinge);
        return hinge;
      }
      const leftDoorPivot=makeEntranceWing(true);
      const rightDoorPivot=makeEntranceWing(false);
      // Warm recessed fixtures beneath the entrance awning; material glow only.
      const lightFixture=new THREE.MeshStandardMaterial({
        color:0xf9e4bb,emissive:0xf3d3a0,emissiveIntensity:0.22,roughness:0.44
      });
      for(const z of [-1.20,1.20]){
        addDoorPart(bGroup,0.39,0.028,0.34,
          frontFaceX+outDir*0.82,3.694,z,lightFixture);
      }
      bGroup.userData.entranceDoors = { left: leftDoorPivot, right: rightDoorPivot, outDir };
      return bGroup;
    }


    // =====================================================================
    // V3 VISUAL PASS — cinematic but asset-free and mobile-friendly.
    // No extra CDN dependencies, camera changes, or interactive colliders.
    // =====================================================================
    function makeSoftFxTexture(key, warm = false) {
      return makeCanvasTexture(key, 128, 128, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        const grd = ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);
        grd.addColorStop(0, warm ? 'rgba(255,246,211,0.76)' : 'rgba(255,255,255,0.9)');
        grd.addColorStop(0.30, warm ? 'rgba(255,229,166,0.27)' : 'rgba(255,255,255,0.44)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle=grd; ctx.fillRect(0,0,w,h);
      });
    }

    function addRoomArchitecturalPolish(group, width, depth, height) {
      const wood = getProceduralPBRMaterial('wood', 0x8d6545, 0.63, 0.02, 4);
      const chalk = new THREE.MeshStandardMaterial({color:0xf2f1ec,roughness:0.88});
      const softMetal = new THREE.MeshStandardMaterial({color:0xd3d7dd,metalness:0.34,roughness:0.44});
      const strip = (w,h,d,x,y,z,mat) => {
        const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
        m.position.set(x,y,z); m.receiveShadow=true; group.add(m); return m;
      };
      // Recessed skirtings/coving sit flush against walls; no camera collision.
      strip(width-0.32,0.12,0.045,0,0.08,-depth/2+0.155,wood);
      strip(width-0.32,0.095,0.07,0,height-0.12,-depth/2+0.16,chalk);
      for (const sign of [-1,1]) {
        strip(0.045,0.12,depth-0.3,sign*(width/2-0.155),0.08,0,wood);
        strip(0.055,0.095,depth-0.3,sign*(width/2-0.16),height-0.12,0,chalk);
        // Metal bead at ceiling/wall joint simulates the light-cove profile.
        strip(0.022,0.028,depth-0.34,sign*(width/2-0.19),height-0.16,0,softMetal);
      }
      const frontHalf=(width-2.65)/2;
      for(const sign of [-1,1]) {
        strip(frontHalf,0.115,0.052,sign*(width/2-frontHalf/2),0.08,depth/2-0.145,wood);
      }
      // Subtle sunlit pools under side windows, not opaque fake light beams.
      const sunTex = makeSoftFxTexture('warm_sun_pool_v3',true);
      const poolMat = new THREE.MeshBasicMaterial({map:sunTex,transparent:true,opacity:0.17,
        depthWrite:false,blending:THREE.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-1});
      for (let i=-1;i<=1;i++) {
        const pool=new THREE.Mesh(new THREE.PlaneGeometry(2.8,1.7),poolMat);
        pool.rotation.x=-Math.PI/2;
        pool.rotation.z=-0.16;
        pool.position.set(-width/2+2.9,0.025,i*depth*0.28);
        pool.userData.cinematicOnly=true;
        pool.visible=graphicsUltra;
        group.add(pool);
      }
      // Floating dust has no collision and renders as a single draw call.
      const positions = new Float32Array(102*3);
      let seed=94817;
      const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      for(let i=0;i<102;i++) {
        positions[i*3]=(rnd()-0.5)*(width-0.9);
        positions[i*3+1]=0.65+rnd()*(height-0.95);
        positions[i*3+2]=(rnd()-0.5)*(depth-0.8);
      }
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
      const mat=new THREE.PointsMaterial({size:0.043,map:makeSoftFxTexture('dust_spark_v3'),
        color:0xffe9c6,transparent:true,opacity:0.38,depthWrite:false,blending:THREE.AdditiveBlending,
        sizeAttenuation:true});
      const dust=new THREE.Points(geo,mat);
      dust.userData.cinematicOnly=true; dust.visible=graphicsUltra;
      group.add(dust);
      atmosphereMotes=dust;
    }

    function addCampusCinematicPolish(group) {
      const paving=getProceduralPBRMaterial('stone',0xd7d0c0,0.7,0.06,1.5);
      const geometry=new THREE.BoxGeometry(0.32,0.023,0.62);
      // Plaza edge details avoid the central path and fountain basin.
      const pavingInstance=new THREE.InstancedMesh(geometry,paving,84);
      const obj=new THREE.Object3D();
      for(let i=0;i<42;i++) {
        for(let side=0;side<2;side++) {
          obj.position.set(side?5.28:-5.28,0.164,-14.7+i*0.9);
          obj.rotation.set(0,0,0); obj.scale.set(1,1,(i%3===0)?0.93:1);
          obj.updateMatrix(); pavingInstance.setMatrixAt(i*2+side,obj.matrix);
        }
      }
      pavingInstance.instanceMatrix.needsUpdate=true;
      group.add(pavingInstance);

      // Natural thin grass rather than repeated oversized cones and spheres.
      const bladeGeo=new THREE.ConeGeometry(0.035,0.31,3);
      bladeGeo.translate(0,0.15,0);
      const bladeMat=new THREE.MeshStandardMaterial({color:0x3d8e47,roughness:0.95,side:THREE.DoubleSide});
      const grass=new THREE.InstancedMesh(bladeGeo,bladeMat,750);
      let seed=19721120;
      const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      let n=0;
      for(let i=0;i<3800 && n<750;i++) {
        const x=(rnd()-0.5)*100,z=(rnd()-0.5)*105;
        if(Math.abs(x)<25 && z>-23 && z<29) continue;
        obj.position.set(x,0.005,z);obj.rotation.set(0,rnd()*Math.PI*2,0);
        const size=.55+rnd()*.75; obj.scale.set(size,size,size);
        obj.updateMatrix();grass.setMatrixAt(n++,obj.matrix);
      }
      grass.count=n;grass.instanceMatrix.needsUpdate=true;
      grass.userData.cinematicOnly=true;grass.visible=graphicsUltra;
      group.add(grass);

      // Subtle radial halos add highlight sparkle without an expensive bloom pass.
      const glowMap=makeSoftFxTexture('campus_lamp_glow_v3',true);
      const glowMat=new THREE.SpriteMaterial({map:glowMap,color:0xffd49a,
        transparent:true,opacity:0.18,depthWrite:false,blending:THREE.AdditiveBlending});
      for(const z of [19,7,-5]) for(const x of [-4.2,4.2]) {
        const glow=new THREE.Sprite(glowMat);
        glow.position.set(x,3.83,z);glow.scale.set(1.8,1.8,1);
        glow.userData.cinematicOnly=true;glow.visible=graphicsUltra;
        group.add(glow);
      }
    }

    function applyGraphicsQuality() {
      if(!renderer)return;
      const dpr=window.devicePixelRatio||1;
      const mobile=Math.min(window.innerWidth,window.innerHeight)<680;
      const target=graphicsUltra?(mobile?1.4:2.0):(mobile?1.0:1.15);
      renderer.setPixelRatio(Math.min(dpr,target));
      renderer.shadowMap.enabled=true;
      renderer.shadowMap.type=THREE.PCFSoftShadowMap;
      if(sunLight) {
        const resolution=graphicsUltra?(mobile?2048:3072):1024;
        const sh=sunLight.shadow;
        if(sh.mapSize.x!==resolution){
          sh.mapSize.set(resolution,resolution);
          if(sh.map){sh.map.dispose();sh.map=null;}
          renderer.shadowMap.needsUpdate=true;
        }
        sh.radius=graphicsUltra?1.3:1.15;
      }
      // Prefer sharper oblique floor textures, with a bounded GPU budget.
      const maxAniso=renderer.capabilities?.getMaxAnisotropy?.()||4;
      const factor=Math.min(maxAniso,graphicsUltra?16:6);
      Object.values(TEXTURE_CACHE).forEach(tex=>{
        if(tex?.isTexture && tex.anisotropy!==factor){
          tex.anisotropy=factor;tex.needsUpdate=true;
        }
      });
      if(scene)scene.traverse(obj=>{
        if(obj.userData?.cinematicOnly)obj.visible=graphicsUltra;
      });
      const btn=document.getElementById('btn-toggle-gfx');
      if(btn)btn.title=graphicsUltra
        ? 'Ultra: sắc nét hơn, bóng đổ chi tiết và vật liệu PBR'
        : 'Tối ưu: độ phân giải và bóng đổ nhẹ cho thiết bị yếu';
      if(sceneMode)configureLightingForMode(sceneMode);
    }

    function buildCampusScene() {
      while (campusGroup.children.length > 0) campusGroup.remove(campusGroup.children[0]);
      campusFlags = [];
      campusGardenBeds = [];
      campusClouds = [];
      campusWaterRipples = [];
      campusBirds = [];
      fountainWaterJets = [];
      scooterWheels = [];

      const grassGround = new THREE.Mesh(
        new THREE.PlaneGeometry(240, 240),
        getProceduralPBRMaterial('grass', 0x16a34a, 0.85, 0.02, 34)
      );
      grassGround.rotation.x = -Math.PI / 2;
      grassGround.receiveShadow = true;
      campusGroup.add(grassGround);

      const mountainMat1 = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.9 });
      const mountainMat2 = new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.92 });
      for (let m = 0; m < 18; m++) {
        const ang = (m / 18) * Math.PI * 2;
        const dist = 88 + (m % 3) * 14;
        const mh = 18 + (m % 4) * 7;
        const mr = 22 + (m % 3) * 8;
        const hill = new THREE.Mesh(new THREE.ConeGeometry(mr, mh, 14), m % 2 === 0 ? mountainMat1 : mountainMat2);
        hill.position.set(Math.cos(ang) * dist, mh * 0.45, Math.sin(ang) * dist);
        campusGroup.add(hill);
      }

      const courtyard = new THREE.Mesh(
        new THREE.BoxGeometry(42, 0.14, 48),
        getProceduralPBRMaterial('stone', 0xe2e8f0, 0.44, 0.08, 12)
      );
      courtyard.position.set(0, 0.07, 4);
      courtyard.receiveShadow = true;
      campusGroup.add(courtyard);

      const fencePillarMat = getProceduralPBRMaterial('stone', 0xf8fafc, 0.4);
      const railMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.78, roughness: 0.28 });
      for (let fx = -20; fx <= 20; fx += 5) {
        if (Math.abs(fx) < 6) continue;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.35, 0.42), fencePillarMat);
        post.position.set(fx, 0.68, 24);
        campusGroup.add(post);
      }
      [-13.2, 13.2].forEach((rx) => {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(14.5, 0.85, 0.08), railMat);
        rail.position.set(rx, 0.65, 24);
        campusGroup.add(rail);
      });

      const carpet = new THREE.Mesh(
        new THREE.BoxGeometry(3.4, 0.04, 34),
        new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.65 })
      );
      carpet.position.set(0, 0.16, 15);
      carpet.receiveShadow = true;
      campusGroup.add(carpet);

      const carpetTrim = new THREE.Mesh(
        new THREE.BoxGeometry(3.68, 0.03, 34),
        new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.55 })
      );
      carpetTrim.position.set(0, 0.15, 15);
      campusGroup.add(carpetTrim);

      const lampGlobeMat = new THREE.MeshStandardMaterial({
        color: 0xfef9c3,
        emissive: 0xfde047,
        emissiveIntensity: 0.18,
        roughness: 0.28
      });
      [[-4.2, 19], [4.2, 19], [-4.2, 7], [4.2, 7], [-4.2, -5], [4.2, -5]].forEach(([lx, lz]) => {
        const lamp = new THREE.Group();
        lamp.position.set(lx, 0.14, lz);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.1, 3.6, 12), railMat);
        pole.position.y = 1.8;
        pole.castShadow = true;
        lamp.add(pole);
        const globe = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 14), lampGlobeMat);
        globe.position.y = 3.72;
        lamp.add(globe);
        campusGroup.add(lamp);
      });

      const vnFlagTex = makeCanvasTexture('vn_flag', 256, 170, (ctx, w, h) => {
        ctx.fillStyle = '#da251d';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ffff00';
        ctx.beginPath();
        const cx = w / 2;
        const cy = h / 2;
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? 46 : 18;
          const a = (i * Math.PI) / 5 - Math.PI / 2;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      });

      [-6.5, 6.5].forEach((fx) => {
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.09, 9.5, 12),
          new THREE.MeshStandardMaterial({ color: 0xf1f5f9, metalness: 0.85, roughness: 0.2 })
        );
        pole.position.set(fx, 4.75, 19);
        campusGroup.add(pole);

        const flagMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(1.9, 1.25, 10, 6),
          new THREE.MeshStandardMaterial({ map: vnFlagTex, side: THREE.DoubleSide, roughness: 0.45 })
        );
        flagMesh.position.set(fx + 0.98, 8.7, 19);
        campusGroup.add(flagMesh);
        campusFlags.push(flagMesh);
      });

      const gateGroup = new THREE.Group();
      gateGroup.position.set(0, 0, 24);
      const redMat = new THREE.MeshPhysicalMaterial({ color: 0xb91c1c, roughness: 0.3, metalness: 0.14, clearcoat: 0.45 });
      const darkRedMat = new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.42 });
      const goldMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.22, metalness: 0.82 });
      const gateRoofMat = getProceduralPBRMaterial('roof', 0x991b1b, 0.4, 0.16);

      [-4.9, 4.9].forEach((px, idx) => {
        const plinth1 = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.36, 1.45), darkRedMat);
        plinth1.position.set(px, 0.18, 0);
        gateGroup.add(plinth1);

        const plinth2 = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.34, 1.22), goldMat);
        plinth2.position.set(px, 0.53, 0);
        gateGroup.add(plinth2);

        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 6.2, 22), redMat);
        pillar.position.set(px, 3.6, 0);
        pillar.castShadow = true;
        gateGroup.add(pillar);

        const sidePillar = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 4.8, 16), redMat);
        sidePillar.position.set(px + (idx === 0 ? -0.92 : 0.92), 2.9, 0);
        gateGroup.add(sidePillar);

        [1.1, 3.6, 5.9].forEach((ry) => {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.045, 10, 22), goldMat);
          ring.rotation.x = Math.PI / 2;
          ring.position.set(px, ry, 0);
          gateGroup.add(ring);
        });

        const couplet = createSignBoard(
          idx === 0 ? 'TÔN SƯ TRỌNG ĐẠO' : 'TRI ÂN THẦY CÔ 20/11',
          '#7f1d1d',
          '#fde047',
          '#fef08a',
          0.66,
          3.6,
          true
        );
        couplet.position.set(px, 3.6, 0.52);
        gateGroup.add(couplet);

        const lanternX = px + (idx === 0 ? 0.95 : -0.95);
        const lantern = new THREE.Mesh(
          new THREE.CylinderGeometry(0.26, 0.26, 0.52, 8),
          new THREE.MeshStandardMaterial({ color: 0xdc2626, emissive: 0xf59e0b, emissiveIntensity: 0.18 })
        );
        lantern.position.set(lanternX, 5.25, 0);
        gateGroup.add(lantern);

        const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.34, 8), goldMat);
        tassel.position.set(lanternX, 4.82, 0);
        gateGroup.add(tassel);
      });

      const archFrame = new THREE.Mesh(new THREE.BoxGeometry(11.8, 1.25, 1.45), redMat);
      archFrame.position.set(0, 6.45, 0);
      archFrame.castShadow = true;
      gateGroup.add(archFrame);

      const archBorder = new THREE.Mesh(new THREE.BoxGeometry(12.1, 0.16, 1.55), goldMat);
      archBorder.position.set(0, 5.82, 0);
      gateGroup.add(archBorder);

      const gateRoof1 = new THREE.Mesh(new THREE.BoxGeometry(13.2, 0.46, 2.25), gateRoofMat);
      gateRoof1.position.set(0, 7.22, 0);
      gateGroup.add(gateRoof1);

      [-6.7, 6.7].forEach((ex, idx) => {
        const eave = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 6), goldMat);
        eave.position.set(ex, 7.52, 0);
        eave.rotation.z = idx === 0 ? 0.55 : -0.55;
        gateGroup.add(eave);
      });

      const gateTopTier = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.44, 1.65), gateRoofMat);
      gateTopTier.position.set(0, 7.68, 0);
      gateGroup.add(gateTopTier);

      const ridgeFinial = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 14), goldMat);
      ridgeFinial.position.set(0, 8.12, 0);
      gateGroup.add(ridgeFinial);

      const gateBanner = createSignBoard('CHÀO MỪNG NGÀY NHÀ GIÁO VIỆT NAM 20/11', '#991b1b', '#fde047', '#fef08a', 9.4, 0.9);
      gateBanner.position.set(0, 6.45, 0.78);
      gateGroup.add(gateBanner);
      campusGroup.add(gateGroup);

      const pondGroup = new THREE.Group();
      pondGroup.position.set(0, 0.15, 2);
      const pondRim = new THREE.Mesh(
        new THREE.TorusGeometry(3.15, 0.28, 14, 36),
        getProceduralPBRMaterial('stone', 0xf8fafc, 0.32)
      );
      pondRim.rotation.x = Math.PI / 2;
      pondRim.position.y = 0.22;
      pondGroup.add(pondRim);

      const waterDisc = new THREE.Mesh(
        new THREE.CircleGeometry(3.05, 36),
        new THREE.MeshPhysicalMaterial({
          color: 0x0284c7,
          roughness: 0.06,
          metalness: 0.15,
          clearcoat: 1.0,
          transparent: true,
          opacity: 0.88
        })
      );
      waterDisc.rotation.x = -Math.PI / 2;
      waterDisc.position.y = 0.24;
      pondGroup.add(waterDisc);

      for (let r = 0; r < 4; r++) {
        const rip = new THREE.Mesh(
          new THREE.RingGeometry(0.5, 0.58, 32),
          new THREE.MeshBasicMaterial({ color: 0xe0f2fe, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
        );
        rip.rotation.x = -Math.PI / 2;
        rip.position.y = 0.26;
        rip.userData = { phase: r * 0.25 };
        pondGroup.add(rip);
        campusWaterRipples.push(rip);
      }

      const fountainPedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.68, 1.35, 18),
        getProceduralPBRMaterial('stone', 0xfef3c7, 0.35)
      );
      fountainPedestal.position.y = 0.75;
      pondGroup.add(fountainPedestal);

      const upperBasin = new THREE.Mesh(
        new THREE.CylinderGeometry(1.15, 0.55, 0.26, 20),
        getProceduralPBRMaterial('stone', 0xf8fafc, 0.3)
      );
      upperBasin.position.y = 1.35;
      pondGroup.add(upperBasin);

      const jetMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.75 });
      for (let j = 0; j < 12; j++) {
        const drop = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), jetMat);
        drop.userData = { angle: (j / 12) * Math.PI * 2, phase: (j % 4) * 0.25 };
        pondGroup.add(drop);
        fountainWaterJets.push(drop);
      }

      const lotusBloom = createFlowerBouquet();
      lotusBloom.position.y = 1.56;
      lotusBloom.scale.set(2.2, 2.2, 2.2);
      pondGroup.add(lotusBloom);
      campusGroup.add(pondGroup);

      const teacherBuilding = createCampusSchoolBuilding({
        side: 'teacher',
        mainColor: 0x0284c7,
        trimColor: 0x0369a1,
        roofColor: 0x1e3a8a,
        titleText: 'TRI ÂN THẦY CÔ GIÁO • TÒA XANH'
      });
      teacherBuilding.position.set(-14.2, 0, -2);
      campusGroup.add(teacherBuilding);
      campusGroup.userData.teacherBuilding = teacherBuilding;

      const femaleBuilding = createCampusSchoolBuilding({
        side: 'female',
        mainColor: 0xdb2777,
        trimColor: 0xbe185d,
        roofColor: 0x831843,
        titleText: 'SỰ KIỆN 20-11 • TÒA HỒNG'
      });
      femaleBuilding.position.set(14.2, 0, -2);
      campusGroup.add(femaleBuilding);
      campusGroup.userData.femaleBuilding = femaleBuilding;

      const brickMat = getProceduralPBRMaterial('brick', 0xb45309, 0.68);
      const stoneTrimMat = getProceduralPBRMaterial('tile', 0xf8fafc, 0.38);
      const soilMat = new THREE.MeshStandardMaterial({ color: 0x3f2305, roughness: 0.92 });
      const foliageMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.72 });
      const bedCoords = [
        [-7.5, 15], [7.5, 15], [-7.5, 9], [7.5, 9],
        [-7.5, 3], [7.5, 3], [-7.5, -8], [7.5, -8], [-11, 19], [11, 19]
      ];
      bedCoords.forEach(([bx, bz]) => {
        const bed = new THREE.Group();
        bed.position.set(bx, 0.08, bz);
        const brick = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.42, 1.65), brickMat);
        brick.position.y = 0.21;
        brick.castShadow = true;
        bed.add(brick);

        const rim = new THREE.Mesh(new THREE.BoxGeometry(2.92, 0.08, 1.76), stoneTrimMat);
        rim.position.y = 0.44;
        bed.add(rim);

        const soil = new THREE.Mesh(new THREE.BoxGeometry(2.58, 0.06, 1.44), soilMat);
        soil.position.y = 0.43;
        bed.add(soil);

        const flowerPalette = [0xf43f5e, 0xfacc15, 0xfb7185, 0xf97316, 0xa855f7, 0xffffff];
        let idxCount = 0;
        for (let fx = -0.95; fx <= 0.95; fx += 0.48) {
          for (let fz = -0.38; fz <= 0.38; fz += 0.38) {
            idxCount++;
            const bush = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), foliageMat);
            bush.scale.set(1.15, 0.75, 1.15);
            bush.position.set(fx, 0.54, fz);
            bed.add(bush);

            const bloom = new THREE.Mesh(
              new THREE.SphereGeometry(0.11, 10, 10),
              new THREE.MeshStandardMaterial({ color: flowerPalette[idxCount % flowerPalette.length], roughness: 0.38 })
            );
            bloom.position.set(fx, 0.74, fz);
            bed.add(bloom);
          }
        }
        campusGroup.add(bed);
        campusGardenBeds.push(bed);
      });

      const trunkMat = getProceduralPBRMaterial('wood', 0x5c3a21, 0.8);
      const canopyMat1 = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.74 });
      const canopyMat2 = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.68 });
      [
        [-22, 18], [22, 18], [-22, 4], [22, 4], [-22, -12], [22, -12],
        [-12, -18], [0, -19], [12, -18]
      ].forEach(([tx, tz]) => {
        const tree = new THREE.Group();
        tree.position.set(tx, 0, tz);
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.45, 3.2, 12), trunkMat);
        trunk.position.y = 1.6;
        trunk.castShadow = true;
        tree.add(trunk);

        [[0, 4.3, 0, 2.05, canopyMat1], [-1.15, 3.75, 0.65, 1.45, canopyMat2], [1.15, 3.85, -0.55, 1.5, canopyMat2], [0, 5.25, 0.3, 1.35, canopyMat1]].forEach(([cx, cy, cz, cr, cm]) => {
          const crown = new THREE.Mesh(new THREE.SphereGeometry(cr, 12, 12), cm);
          crown.position.set(cx, cy, cz);
          crown.castShadow = true;
          tree.add(crown);
        });
        tree.add(createContactShadow(2.2, 2.2, 0.3));
        campusGroup.add(tree);
      });

      const birdMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc, side: THREE.DoubleSide });
      for (let b = 0; b < 7; b++) {
        const bird = new THREE.Group();
        const lWing = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.14), birdMat);
        lWing.position.x = -0.22;
        const rWing = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.14), birdMat);
        rWing.position.x = 0.22;
        bird.add(lWing, rWing);
        bird.position.set(-18 + b * 5.5, 22 + (b % 3) * 2.5, -10 + (b % 4) * 6);
        bird.userData = { lWing, rWing, phase: b * 0.9, radius: 18 + b * 2.5, speed: 0.18 + (b % 3) * 0.04 };
        campusGroup.add(bird);
        campusBirds.push(bird);
      }

      const cloudMap = makeSoftFxTexture('cloud_billow_v3');
      const cloudMat = new THREE.SpriteMaterial({map:cloudMap,color:0xffffff,
        transparent:true,opacity:0.62,depthWrite:false});
      [[-32, 36, -45], [18, 42, -55], [44, 34, -38], [-12, 39, -62]].forEach(([cx, cy, cz]) => {
        const cloud = new THREE.Group();
        cloud.position.set(cx, cy, cz);
        [[0,0,11,4.8],[-3,0.1,8.1,3.8],[3,0.2,8.4,3.9]].forEach(([ox,oy,w,h])=>{
          const puff=new THREE.Sprite(cloudMat);
          puff.position.set(ox,oy,0);puff.scale.set(w,h,1);cloud.add(puff);
        });
        campusGroup.add(cloud);
        campusClouds.push(cloud);
      });

      const cub = createHondaCubScooter();
      campusScooterGroup = cub.group;
      scooterRiderMesh = cub.rider;
      scooterWheels = cub.wheels;
      campusScooterGroup.position.set(0, 0.14, 18);
      campusGroup.add(campusScooterGroup);

      // During the intro, the single protagonist is riding the scooter.
      // Dismounting reparents this same mesh to the campus, not a clone.
      campusHero = getProtagonist();

      addCampusCinematicPolish(campusGroup);
      campusGroup.traverse((o) => {
        if (o.isMesh && o.userData && o.userData.interactiveType) interactiveList.push(o);
      });
    }

    // =========================================================================
    // 6. INTERIOR SHARED HELPERS (DOORS, 2-FLIGHT STAIRS, HALLWAY & ROOM SHELLS)
    // =========================================================================
    function createModernDoubleDoor(x, z, doorType, labelText) {
      // V9.2 architectural door: the glass is inside a real panel frame.
      // Hinge pivots and interaction IDs remain backward compatible.
      const group=new THREE.Group();
      group.position.set(x,0,z);
      const pink=currentBuildingSide==='female';
      const frame=new THREE.MeshStandardMaterial({color:pink?0x493d48:0x283846,roughness:0.42,metalness:0.42});
      const wood=getProceduralPBRMaterial('wood',pink?0x966e69:0x906847,0.58,0.015,1.8);
      const steel=new THREE.MeshStandardMaterial({color:0xcbd5d9,roughness:0.30,metalness:0.80});
      const bronze=new THREE.MeshStandardMaterial({color:pink?0xc7a185:0xb5a077,roughness:0.37,metalness:0.68});
      const inlay=new THREE.MeshStandardMaterial({color:pink?0x805a63:0x536979,roughness:0.68,metalness:0.04});
      const glazing=new THREE.MeshPhysicalMaterial({
        color:0xb6dce7,roughness:0.19,metalness:0.06,
        transparent:true,opacity:0.63,depthWrite:false,
        side:THREE.DoubleSide,clearcoat:0.42
      });
      function part(parent,w,h,d,x,y,z,mat,hit=false){
        const obj=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
        obj.position.set(x,y,z);
        obj.castShadow=mat!==glazing;
        obj.receiveShadow=true;
        if(hit)obj.userData.interactiveType=doorType;
        parent.add(obj);
        return obj;
      }
      // Surround, architrave, transom and flush threshold.
      for(const x of [-1.12,1.12]){
        part(group,0.12,2.97,0.24,x,1.485,0,frame);
        part(group,0.028,2.88,0.275,x,1.48,0.015,bronze);
      }
      part(group,2.36,0.12,0.25,0,2.92,0,frame);
      part(group,2.36,0.11,0.25,0,2.40,0,frame);
      part(group,2.17,0.41,0.027,0,2.675,0,glazing);
      part(group,0.035,0.41,0.075,0,2.675,0.03,frame);
      part(group,2.17,0.024,0.09,0,2.83,0.045,bronze);
      part(group,2.14,0.025,0.28,0,0.025,0,steel);
      const sign=createSignBoard(labelText,pink?'#442b42':'#243f50',
        pink?'#e2b49a':'#b9cdd0','#fffaf0',2.08,0.36);
      sign.position.set(0,3.24,0.13);
      group.add(sign);
      function makeLeaf(isLeft){
        const dir=isLeft?1:-1;
        const pivot=new THREE.Group();
        pivot.position.set(isLeft?-1.05:1.05,0,0);
        const cx=dir*0.515;
        for(const zz of [-0.047,0.047]){
          for(const xx of [dir*0.075,dir*0.955]){
            part(pivot,0.09,2.35,0.027,xx,1.19,zz,wood,true);
          }
          part(pivot,0.97,0.09,0.028,cx,2.325,zz,wood,true);
          part(pivot,0.97,0.095,0.028,cx,0.735,zz,wood,true);
          part(pivot,0.92,0.046,0.027,cx,1.69,zz,bronze,true);
        }
        // The transparent glazing and lower timber inlay share the opening.
        part(pivot,0.85,1.54,0.023,cx,1.51,0,glazing,true);
        part(pivot,0.86,0.62,0.055,cx,0.375,0,inlay,true);
        part(pivot,0.75,0.48,0.061,cx,0.375,0.02,wood,true);
        part(pivot,0.92,0.07,0.072,cx,0.10,0.02,bronze,true);
        // Double-sided vertical pulls with separate mounting bosses.
        const latch=dir*0.83;
        for(const face of [-1,1]){
          const z=face*0.075;
          part(pivot,0.12,0.22,0.021,latch,1.13,z,bronze,true);
          for(const y of [1.01,1.29])
            part(pivot,0.092,0.027,0.13,latch,y,face*0.10,steel,true);
          const grip=new THREE.Mesh(new THREE.CylinderGeometry(0.016,0.016,0.36,12),steel);
          grip.position.set(latch,1.15,face*0.17);
          grip.userData.interactiveType=doorType;
          grip.castShadow=true;
          pivot.add(grip);
        }
        group.add(pivot);
        return pivot;
      }
      const leftPivot=makeLeaf(true),rightPivot=makeLeaf(false);
      return {group,pivots:{left:leftPivot,right:rightPivot}};
    }

    function createCenterTwoFlightStaircase(group, actionType) {
      const stairGroup = new THREE.Group();
      stairGroup.position.set(0, 0, 0.80);
      const stone = getProceduralPBRMaterial('tile', 0x64748b, 0.65, 0.025, 2);
      const riserMat = new THREE.MeshStandardMaterial({ color: 0xd4dbe2, roughness: 0.85 });
      const nosing = new THREE.MeshStandardMaterial({ color: 0x6b7685, metalness: 0.12, roughness: 0.66 });
      const steel = new THREE.MeshStandardMaterial({ color: 0x9ca9b6, roughness: 0.34, metalness: 0.75 });
      const railMat = new THREE.MeshStandardMaterial({ color: 0x526170, roughness: 0.32, metalness: 0.6 });
      const paint = new THREE.MeshStandardMaterial({ color: 0xf0f0ee, roughness: 0.85 });
      const n = 11, totalRise = 1.9, run = 2.9, rise = totalRise / n, depth = run / n;
      const x1=1.04, x2=-1.04, zFront=0, zRear=-run;

      function box(w,h,d,x,y,z,mat,interactive=false) {
        const obj = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
        obj.position.set(x,y,z); obj.castShadow = true; obj.receiveShadow = true;
        if(mat===stone && h<=0.08) addPrecisionEdge(obj,0x334155,0.22);
        if(interactive && actionType) obj.userData.interactiveType=actionType;
        stairGroup.add(obj); return obj;
      }
      // Stairwell walls leave the front entry unobstructed.
      box(0.14,4.25,4.15, 2.15,2.125,-1.90,paint);
      box(0.14,4.25,4.15,-2.15,2.125,-1.90,paint);
      box(4.44,4.25,0.16,0,2.125,-4.04,paint);
      const glass = new THREE.MeshPhysicalMaterial({
        color:0xbdd5e2, transparent:true, opacity:0.26, roughness:0.45,
        depthWrite:false, side:THREE.DoubleSide
      });
      // Transparent glazing is bounded by discrete metal frame bars.
      box(2.09,1.55,0.07,0,2.68,-3.94,glass);
      box(2.25,0.09,0.12,0,3.50,-3.89,steel);
      box(2.25,0.09,0.12,0,1.87,-3.89,steel);
      box(0.09,1.72,0.12,-1.12,2.68,-3.89,steel);
      box(0.09,1.72,0.12,1.12,2.68,-3.89,steel);
      box(0.07,1.55,0.11,0,2.68,-3.87,steel);
      box(2.11,0.07,0.11,0,2.68,-3.87,steel);

      for(let i=0;i<n;i++){
        const height=(i+1)*rise;
        const firstZ=-(i+0.5)*depth;
        const secondZ=-run+(i+0.5)*depth;
        // Continuous enclosed risers look like concrete, not disconnected floating boxes.
        box(1.75,height,depth+0.005,x1,height/2,firstZ,riserMat,true);
        box(1.81,0.047,depth+0.015,x1,height+0.013,firstZ,stone,true);
        box(1.81,0.018,0.025,x1,height+0.039,firstZ+depth/2-0.015,nosing);
        const upperY=totalRise+height;
        box(1.75,upperY-totalRise,depth+0.005,x2,totalRise+(upperY-totalRise)/2,secondZ,riserMat,true);
        box(1.81,0.047,depth+0.015,x2,upperY+0.013,secondZ,stone,true);
        box(1.81,0.018,0.025,x2,upperY+0.039,secondZ-depth/2+0.015,nosing);
      }

      box(4.02,0.20,1.06,0,1.80,-3.33,paint,true);
      box(4.02,0.052,1.07,0,1.925,-3.33,stone,true);
      box(4.02,0.02,0.028,0,1.955,-2.81,nosing);

      function pipe(a,b,r,material=railMat) {
        const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
        const d = new THREE.Vector3().subVectors(B,A);
        const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,d.length(),12),material);
        mesh.position.copy(A).add(B).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
        mesh.castShadow=true; stairGroup.add(mesh); return mesh;
      }
      // Each railing follows its own riser slope, with slim vertical balusters.
      [0.19,1.90].forEach(x=>{
        pipe([x,0.94,0],[x,totalRise+0.94,-run],0.038);
        for(let i=0;i<=7;i++){
          const t=i/7;
          pipe([x,t*totalRise,-t*run],[x,t*totalRise+0.94,-t*run],0.018,steel);
        }
      });
      [-0.19,-1.90].forEach(x=>{
        pipe([x,totalRise+0.94,-run],[x,totalRise*2+0.94,0],0.038);
        for(let i=0;i<=7;i++){
          const t=i/7;
          pipe([x,totalRise+t*totalRise,-run+t*run],[x,totalRise+t*totalRise+0.94,-run+t*run],0.018,steel);
        }
      });
      pipe([1.9,totalRise+0.95,-3.72],[-1.9,totalRise+0.95,-3.72],0.045);
      for(let x=-1.9;x<=1.9;x+=0.48)
        pipe([x,totalRise,-3.72],[x,totalRise+0.94,-3.72],0.017,steel);

      group.add(stairGroup);
    }


    // Physical vertical alignment between floors:
    // stairwell A: F1 up at +3m -> F2 down at +3m.
    // stairwell B: F2 up at -3m -> F3 down at -3m.
    // Never show an upward stairwell on the top floor.
    const HALL_STAIR = {
      landingY: 3.80,
      up: { hallway: 3.0, hallway2: -3.0 },
      down: { hallway2: 3.0, hallway3: -3.0 },
      shaftHalfWidth: 2.25,
      cutoutZ0: -3.4,
      cutoutZ1: 1.05
    };

    function createHallwayStairLayout(targetGroup, level) {
      const upAction = level === 1 ? 'stairs_up_2' : level === 2 ? 'stairs_up_3' : null;
      const downAction = level === 2 ? 'stairs_down_1' : level === 3 ? 'stairs_down_2' : null;
      const upX = level === 1 ? 3 : -3;
      const downX = level === 2 ? 3 : -3;
      if (upAction) {
        const upper = new THREE.Group();
        upper.position.x = upX;
        createCenterTwoFlightStaircase(upper, upAction);
        targetGroup.add(upper);
        registerCollider(upX, -1.17, 4.30, 4.44, 0.02);
        const sign = createSignBoard('LÊN TẦNG ' + (level + 1), '#164e63', '#38bdf8', '#f8fafc', 2.20, 0.39);
        sign.position.set(upX + 1.04, 2.15, 1.30);
        targetGroup.add(sign);
      }
      if (downAction) {
        // Re-use exactly the same flight geometry at the elevation below the
        // current floor. The uppermost tread is level with the current floor.
        // A real cutout in the corridor slab exposes the descending steps.
        const lower = new THREE.Group();
        lower.position.set(downX, -HALL_STAIR.landingY, 0);
        createCenterTwoFlightStaircase(lower, downAction);
        targetGroup.add(lower);
        registerCollider(downX, -1.17, 4.30, 4.44, 0.02);
        const sign = createSignBoard('XUỐNG TẦNG ' + (level - 1), '#78350f', '#fbbf24', '#fff7ed', 2.25, 0.39);
        sign.position.set(downX - 1.04, 2.15, 1.30);
        targetGroup.add(sign);
      }
    }

    function buildHallwayCorridorShell(targetGroup, floorColor = 0xe2e8f0, level = 1) {
      const theme = getActiveBuildingTheme();
      // Corridor slabs have different openings at each floor. A down stair
      // needs a hole in the FLOOR, an up stair needs a hole in the CEILING.
      const stoneFloor = getProceduralPBRMaterial('tile', floorColor, 0.34, 0.06, 8);
      const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f5f4, roughness: 0.83 });
      const floorHoleX = level === 2 ? 3 : level === 3 ? -3 : null;
      const ceilingHoleX = level === 1 ? 3 : level === 2 ? -3 : null;
      function makePanel(x0,x1,z0,z1,y,material) {
        if(x1 - x0 < 0.04 || z1 - z0 < 0.04) return;
        const panel = new THREE.Mesh(new THREE.BoxGeometry(x1-x0,0.2,z1-z0),material);
        panel.position.set((x0+x1)/2,y,(z0+z1)/2);
        panel.receiveShadow=true;
        targetGroup.add(panel);
      }
      function makeSlab(y, material, holeX) {
        if(holeX === null) {
          makePanel(-13,13,-3.4,3.8,y,material);
          return;
        }
        const xMin=holeX-HALL_STAIR.shaftHalfWidth, xMax=holeX+HALL_STAIR.shaftHalfWidth;
        makePanel(-13,xMin,-3.4,3.8,y,material);
        makePanel(xMax,13,-3.4,3.8,y,material);
        makePanel(xMin,xMax,-3.4,HALL_STAIR.cutoutZ0,y,material);
        makePanel(xMin,xMax,HALL_STAIR.cutoutZ1,3.8,y,material);
      }
      makeSlab(-0.10, stoneFloor, floorHoleX);
      makeSlab(3.90, ceilingMaterial, ceilingHoleX);

      [-8.5, -3.8, 3.8, 8.5].forEach((lx) => {
        const led = new THREE.Mesh(
          new THREE.BoxGeometry(1.6, 0.05, 0.45),
          new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfef9c3, emissiveIntensity: 0.35 })
        );
        led.position.set(lx, 3.78, 0.2);
        targetGroup.add(led);
      });

      [-6.5, 6.5].forEach((px) => {
        const pt = new THREE.PointLight(0xfffbeb, 0.62, 16);
        pt.position.set(px, 3.4, 0.4);
        targetGroup.add(pt);
      });

      const wallMat = getProceduralPBRMaterial('plaster',theme.wallAccentHex,0.87,0,3);
      const dadoMat = getProceduralPBRMaterial('wood', 0x92400e, 0.48, 0.08, 4);

      // Door openings correspond to the interactive frames; no overlapping wall panels.
      function portalWall(x0, x1, z, portalXs) {
        const ranges = portalXs.map(cx => [cx - 1.16, cx + 1.16]).sort((a,b)=>a[0]-b[0]);
        let cur=x0;
        ranges.forEach(([a,b]) => {
          if (a>cur) {
            const slab = new THREE.Mesh(new THREE.BoxGeometry(a-cur,3.8,0.25),wallMat);
            slab.position.set((cur+a)/2,1.9,z); targetGroup.add(slab);
          }
          const lintel = new THREE.Mesh(new THREE.BoxGeometry(b-a,0.85,0.25),wallMat);
          lintel.position.set((a+b)/2,3.375,z); targetGroup.add(lintel);
          cur=b;
        });
        if (x1>cur) {
          const slab = new THREE.Mesh(new THREE.BoxGeometry(x1-cur,3.8,0.25),wallMat);
          slab.position.set((cur+x1)/2,1.9,z); targetGroup.add(slab);
        }
      }
      // Only real classroom doors have apertures: floor 1 has rooms
      // 101/102/103, upper floors have the left and right classrooms.
      const rearDoorXs = level === 1 ? [-9.2,-4.6,6.8] : [-6.8,6.8];
      portalWall(-13,13,-3.55,rearDoorXs);
      // The building entrance exists on the ground floor only.
      portalWall(-13,13,3.8,level === 1 ? [0] : []);
      // Trims are also split around the entrance apertures.
      const dadoLeft = new THREE.Mesh(new THREE.BoxGeometry(11.75,0.82,0.06),dadoMat);
      dadoLeft.position.set(-7.125,0.41,3.65);
      const dadoRight = dadoLeft.clone(); dadoRight.position.x=7.125;
      targetGroup.add(dadoLeft,dadoRight);

      const winGlassMat = new THREE.MeshPhysicalMaterial({ color: 0xbae6fd, emissive: 0xe0f2fe, emissiveIntensity: 0.35, roughness: 0.1 });
      const winFrameMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7 });
      [-9.5, -5.2, 5.2, 9.5].forEach((wx) => {
        const wf = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.55, 0.14), winFrameMat);
        wf.position.set(wx, 2.15, 3.66);
        targetGroup.add(wf);
        const wg = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.35, 0.16), winGlassMat);
        wg.position.set(wx, 2.15, 3.66);
        targetGroup.add(wg);
      });

      [-13, 13].forEach((ex) => {
        const ew = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.8, 7.4), wallMat);
        ew.position.set(ex, 1.9, 0.12);
        targetGroup.add(ew);
      });

      // Corridor Benches, Potted Plants, Bulletin Boards & Lively Students
      [-11.4, 11.4].forEach((px) => {
        const plant = createPottedIndoorPlant(0.95);
        plant.position.set(px, 0, -2.9);
        targetGroup.add(plant);
      });

      [-7.4, 7.4].forEach((bx) => {
        const bench = createWoodenBench(2.1);
        bench.position.set(bx, 0, 2.95);
        targetGroup.add(bench);
        registerCollider(bx,2.95,2.1,0.65,0.1);

        const bulletin = createSignBoard('BẢNG TIN CHÀO MỪNG NGÀY NHÀ GIÁO VIỆT NAM 20/11', theme.signBg, '#facc15', '#fef9c3', 2.4, 1.15);
        bulletin.rotation.y = Math.PI;
        bulletin.position.set(bx, 2.15, 3.58);
        targetGroup.add(bulletin);
      });

      const hallSt1 = createRealisticHuman({ gender: 'female', role: 'student', shirtColor: 0xffffff, hasBouquet: true });
      hallSt1.position.set(-6.8, 0, 0.35);
      hallSt1.rotation.y = 0.6;
      targetGroup.add(hallSt1);

      const hallSt2 = createRealisticHuman({ gender: 'male', role: 'student', shirtColor: 0xffffff, hasBouquet: false });
      hallSt2.position.set(-5.9, 0, 0.65);
      hallSt2.rotation.y = -0.8;
      targetGroup.add(hallSt2);

      const hallTeacher = createRealisticHuman({
        gender: currentBuildingSide === 'female' ? 'female' : 'male',
        role: 'teacher',
        shirtColor: theme.teacherShirt
      });
      hallTeacher.position.set(5.4, 0, -0.35);
      hallTeacher.rotation.y = -0.5;
      targetGroup.add(hallTeacher);

      activeIdleCharacters.push(
        { mesh: hallSt1, phase: 0.4 },
        { mesh: hallSt2, phase: 1.7 },
        { mesh: hallTeacher, phase: 2.5 }
      );

      const floorGloss = new THREE.Mesh(
        new THREE.PlaneGeometry(25.6, 6.8),
        new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 0.12,
          metalness: 0.08,
          clearcoat: 0.9,
          transparent: true,
          opacity: 0.14
        })
      );
      floorGloss.rotation.x = -Math.PI / 2;
      floorGloss.position.set(0, 0.006, 0.2);
      targetGroup.add(floorGloss);
    }

    function buildRoomShell(targetGroup, { width = 14, depth = 12, height = 3.8, exitType = 'exit_to_hallway1', floorType = 'tile', floorColor = 0xf1f5f9, withWindows = true }) {
      const theme = getActiveBuildingTheme();
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.2, depth),
        getProceduralPBRMaterial(floorType, floorColor, 0.38, 0.06, 5)
      );
      floor.position.set(0, -0.1, 0);
      floor.receiveShadow = true;
      targetGroup.add(floor);

      const ceil = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.2, depth),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 })
      );
      ceil.position.set(0, height + 0.1, 0);
      targetGroup.add(ceil);

      const wallMat = getProceduralPBRMaterial('plaster',theme.wallAccentHex,0.87,0,3);
      const dadoMat = getProceduralPBRMaterial('wood', 0x92400e, 0.5, 0.06, 4);

      const backW = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.24), wallMat);
      backW.position.set(0, height / 2, -depth / 2);
      targetGroup.add(backW);

      const backDado = new THREE.Mesh(new THREE.BoxGeometry(width - 0.3, 0.85, 0.06), dadoMat);
      backDado.position.set(0, 0.425, -depth / 2 + 0.14);
      targetGroup.add(backDado);

      // Real door aperture: two piers and a lintel. The old full wall hid the door.
      const aperture = 2.32;
      [-1, 1].forEach(sgn => {
        const sideWidth = (width - aperture) / 2;
        const part = new THREE.Mesh(new THREE.BoxGeometry(sideWidth, height, 0.24), wallMat);
        part.position.set(sgn * (aperture/2 + sideWidth/2), height/2, depth/2);
        targetGroup.add(part);
      });
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(aperture, Math.max(0.25, height - 2.95), 0.24), wallMat);
      lintel.position.set(0, (height + 2.95) / 2, depth/2);
      targetGroup.add(lintel);

      // Three glazed side windows with actual holes (not decals covering solid brick).
      const windowZ = [-depth * 0.28, 0, depth * 0.28];
      [-1, 1].forEach(sgn => {
        const wallX = sgn * width/2;
        if (sgn > 0 || !withWindows) {
          const solid = new THREE.Mesh(new THREE.BoxGeometry(0.24, height, depth), wallMat);
          solid.position.set(wallX, height/2, 0);
          targetGroup.add(solid);
        } else {
          const holeBottom = height*0.54 - 0.825;
          const holeTop = height*0.54 + 0.825;
          const addPiece = (z0,z1,y0,y1) => {
            if (z1-z0 < 0.02 || y1-y0 < 0.02) return;
            const part = new THREE.Mesh(new THREE.BoxGeometry(0.24,y1-y0,z1-z0),wallMat);
            part.position.set(wallX,(y0+y1)/2,(z0+z1)/2);
            targetGroup.add(part);
          };
          const spans = windowZ.map(c => [c-1.05, c+1.05]);
          let cur=-depth/2;
          for (const [z0,z1] of spans) {
            addPiece(cur,z0,0,height);
            addPiece(z0,z1,0,holeBottom);
            addPiece(z0,z1,holeTop,height);
            cur=z1;
          }
          addPiece(cur,depth/2,0,height);
        }
        const dado = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.75, depth - 0.3), dadoMat);
        dado.position.set(wallX - sgn * 0.14, 0.375, 0);
        targetGroup.add(dado);
      });

      if (withWindows) {
        addRoomWindowsAndCurtains(
          targetGroup,
          width,
          depth,
          height,
          currentBuildingSide === 'female' ? 0xf472b6 : 0x38bdf8
        );
      }

      const fanGroup = new THREE.Group();
      fanGroup.position.set(0, height - 0.18, 0);
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.12, 12),
        new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7 })
      );
      fanGroup.add(hub);
      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(
          new THREE.BoxGeometry(1.35, 0.02, 0.14),
          new THREE.MeshStandardMaterial({ color: 0xf8fafc })
        );
        blade.rotation.y = (b * Math.PI * 2) / 3;
        blade.position.set(Math.cos((b * Math.PI * 2) / 3) * 0.65, 0, Math.sin((b * Math.PI * 2) / 3) * 0.65);
        fanGroup.add(blade);
      }
      targetGroup.add(fanGroup);
      ceilingFans.push(fanGroup);

      const ptLight = new THREE.PointLight(0xfffbeb, 0.6, 20);
      ptLight.position.set(0, height - 0.48, 0);
      targetGroup.add(ptLight);
      // Recessed LED panels in a classroom-realistic 2x2 pattern.
      const ledMat = new THREE.MeshBasicMaterial({ color: 0xfff6d7 });
      for (const xx of [-width*0.25, width*0.25]) {
        for (const zz of [-depth*0.26, depth*0.26]) {
          const ledFrame = new THREE.Mesh(new THREE.BoxGeometry(1.7,0.045,0.32),
                            new THREE.MeshStandardMaterial({color:0xb4becb, metalness:0.65, roughness:0.3}));
          ledFrame.position.set(xx,height-0.055,zz);
          const ledPane = new THREE.Mesh(new THREE.BoxGeometry(1.55,0.015,0.22),ledMat);
          ledPane.position.set(xx,height-0.088,zz);
          targetGroup.add(ledFrame,ledPane);
        }
      }
      // Small loudspeakers and an emergency-exit sign above the actual doorway.
      for (const sx of [-width*0.42,width*0.42]) {
        const speaker = new THREE.Mesh(new THREE.BoxGeometry(0.26,0.42,0.19),
          new THREE.MeshStandardMaterial({color:0x1e293b, roughness:0.64}));
        speaker.position.set(sx,height-0.56,-depth/2+0.2);
        targetGroup.add(speaker);
      }

      const exitDoor = createModernDoubleDoor(0, depth / 2 - 0.14, exitType, 'LỐI RA HÀNH LANG');
      targetGroup.add(exitDoor.group);
      targetGroup.userData.exitDoorPivots = exitDoor.pivots;
      addRoomArchitecturalPolish(targetGroup,width,depth,height);
    }

    // =========================================================================
    // 7. FLOOR 1: HALLWAY 1, ROOM 101, ROOM 102, ROOM 103
    // =========================================================================
    function placeHallwayAvatar(character) {
      // The front entrance opens into a clear lobby, away from both stairwells.
      if (hallwaySpawn && hallwaySpawn.kind === 'entrance') {
        character.position.set(0, 0, 2.82);
      } else if (hallwaySpawn && hallwaySpawn.kind === 'stairs') {
        // Arrive next to the SAME physical shaft used in the preceding level.
        character.position.set(hallwaySpawn.x, 0, 1.64);
      } else {
        character.position.set(lastExitedDoorX, 0, 1.44);
      }
      character.rotation.y = Math.PI;
      hallwaySpawn = null;
    }

    function buildHallway1() {
      const theme = getActiveBuildingTheme();
      while (hallwayGroup.children.length > 0) hallwayGroup.remove(hallwayGroup.children[0]);

      buildHallwayCorridorShell(hallwayGroup, 0xe2e8f0, 1);

      const banner = createSignBoard(`${theme.buildingName.toUpperCase()} • TẦNG 1`, theme.signBg, theme.signBorder, '#ffffff', 5.8, 0.56);
      banner.position.set(0, 3.45, -3.45);
      hallwayGroup.add(banner);

      createHallwayStairLayout(hallwayGroup, 1);

      const d101 = createModernDoubleDoor(-9.2, -3.38, 'enter_101', currentBuildingSide === 'female' ? 'PHÒNG 101 • TRANG TRÍ' : 'PHÒNG 101 • TRI ÂN');
      const d102 = createModernDoubleDoor(-4.6, -3.38, 'enter_102', currentBuildingSide === 'female' ? 'PHÒNG 102 • CUSTOM LỚP' : 'PHÒNG 102 • BÀI GIẢNG');
      const d103 = createModernDoubleDoor(6.8, -3.38, 'enter_103', currentBuildingSide === 'female' ? 'PHÒNG 103 • GÓC SÁNG TẠO' : 'PHÒNG 103 • TRIỂN LÃM');
      const exitCampusDoor = createModernDoubleDoor(0, 3.65, 'exit_to_campus', 'LỐI RA SÂN TRƯỜNG');
      hallwayGroup.add(d101.group, d102.group, d103.group, exitCampusDoor.group);

      hallwayGroup.userData.doors = {
        enter_101: d101.pivots,
        enter_102: d102.pivots,
        enter_103: d103.pivots,
        exit_to_campus: exitCampusDoor.pivots
      };

      roomHero = setProtagonistPose('walking', true);
      placeHallwayAvatar(roomHero);
      roomHero.rotation.y = Math.PI;
      hallwayGroup.add(roomHero);

      hallwayGroup.traverse((o) => {
        if (o.isMesh && o.userData && o.userData.interactiveType) interactiveList.push(o);
      });
    }

    function applyPinkClassroomDecorTheme(group, themeIdx) {
      const palettes = [
        [0xf43f5e, 0xfacc15, 0x38bdf8, 0xfb7185],
        [0xa855f7, 0xf472b6, 0xfde047, 0x34d399],
        [0xf97316, 0xfacc15, 0xef4444, 0x60a5fa]
      ];
      const pal = palettes[themeIdx % palettes.length];
      group.traverse((obj) => {
        if (obj.isMesh && obj.userData && obj.userData.isDecorBalloon) {
          obj.material.color.setHex(pal[obj.userData.colorIdx % pal.length]);
        }
      });
    }

    function addTeacherPodiumAndFurniture(targetGroup, accentHex = 0x0284c7) {
      const podium = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.16, 1.85),
        getProceduralPBRMaterial('wood', 0x92400e, 0.45)
      );
      podium.position.set(0, 0.08, -4.65);
      addPrecisionEdge(podium,0x5a3821,0.24);
      podium.receiveShadow = true;
      targetGroup.add(podium);

      const teacherDesk = new THREE.Mesh(
        new THREE.BoxGeometry(1.75, 0.78, 0.78),
        getProceduralPBRMaterial('wood', 0xb45309, 0.38)
      );
      teacherDesk.position.set(1.55, 0.55, -4.55);
      addPrecisionEdge(teacherDesk,0x4e321c,0.20);
      teacherDesk.castShadow = true;
      targetGroup.add(teacherDesk);

      const vase = createFlowerVase(accentHex);
      vase.position.set(1.95, 0.94, -4.45);
      targetGroup.add(vase);

      const lessonBook = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.045, 0.26),
        new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.4 })
      );
      lessonBook.position.set(1.25, 0.96, -4.48);
      targetGroup.add(lessonBook);

      const shelf1 = createBookshelfWithBooks(accentHex);
      shelf1.position.set(6.45, 0, -3.6);
      shelf1.rotation.y = -Math.PI / 2;
      targetGroup.add(shelf1);

      const shelf2 = createBookshelfWithBooks(accentHex);
      shelf2.position.set(6.45, 0, 1.2);
      shelf2.rotation.y = -Math.PI / 2;
      targetGroup.add(shelf2);

      [[-5.8, -5.0], [5.8, -5.0], [-5.8, 4.8], [5.8, 4.8]].forEach(([px, pz]) => {
        const plant = createPottedIndoorPlant(0.95);
        plant.position.set(px, 0, pz);
        targetGroup.add(plant);
      });
    }

    function addClassroomBoardTrim(targetGroup, board, width, height, isSlide=false) {
      // A separate slim frame must never cover the board texture or intercept
      // touch swipes on the projected Room 102 screen.
      const cx=board.position.x,cy=board.position.y,cz=board.position.z;
      const front=cz + 0.065;
      const rim=new THREE.MeshStandardMaterial({
        color:isSlide?0x374151:0x865b35,roughness:isSlide?0.46:0.61,
        metalness:isSlide?0.50:0.08
      });
      const inner=new THREE.MeshStandardMaterial({
        color:isSlide?0xb7c5d2:0xc59b66,metalness:isSlide?0.55:0.20,roughness:0.46
      });
      const metal=new THREE.MeshStandardMaterial({
        color:0xabb7c3,metalness:0.72,roughness:0.37
      });
      function strip(w,h,d,x,y,z,mat){
        const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
        mesh.position.set(x,y,z);
        mesh.castShadow=true;mesh.receiveShadow=true;
        // The board remains the only interactive surface.
        targetGroup.add(mesh);
        return mesh;
      }
      for(const side of [-1,1]){
        const x=cx+side*(width/2+0.04);
        strip(0.086,height+0.18,0.09,x,cy,front,rim);
        strip(0.015,height+0.05,0.046,cx+side*(width/2-0.012),cy,front+0.026,inner);
      }
      for(const side of [-1,1]){
        const y=cy+side*(height/2+0.04);
        strip(width+0.25,0.09,0.09,cx,y,front,rim);
        strip(width+0.05,0.018,0.042,cx,cy+side*(height/2-0.009),front+0.025,inner);
      }
      // Practical chalk tray or wall-mounted screen shelf, out of the image.
      const trayY=cy-height/2-0.105;
      strip(width+0.13,0.025,isSlide?0.17:0.21,cx,trayY,front+0.10,metal);
      strip(width+0.08,0.013,0.025,cx,trayY+0.018,front+0.19,inner);
      if(!isSlide){
        const chalkColor=new THREE.MeshStandardMaterial({color:0xf7f4e6,roughness:0.95});
        const greenChalk=new THREE.MeshStandardMaterial({color:0xb2e4d0,roughness:0.92});
        for(const [dx,mat] of [[-1.7,chalkColor],[-1.52,greenChalk]]){
          strip(0.12,0.018,0.022,cx+dx,trayY+0.025,front+0.10,mat);
        }
        strip(0.22,0.034,0.13,cx+1.7,trayY+0.035,front+0.09,rim);
      }else{
        // Projector housing with a subdued status LED, no fake opaque overlay.
        const light=new THREE.MeshStandardMaterial({
          color:0xa7e3d9,emissive:0x1d907b,emissiveIntensity:0.24,roughness:0.45
        });
        strip(0.05,0.026,0.022,cx+width/2-0.16,
          cy-height/2-0.11,front+0.2,light);
      }
    }

    function buildRoom101() {
      const theme = getActiveBuildingTheme();
      while (classroomGroup.children.length > 0) classroomGroup.remove(classroomGroup.children[0]);
      room101SeatedStudents = [];
      pinkRoom101Students = [];

      buildRoomShell(classroomGroup, { width: 14, depth: 12, height: 3.8, exitType: 'exit_to_hallway1' });
      addTeacherPodiumAndFurniture(classroomGroup, currentBuildingSide === 'female' ? 0xdb2777 : 0x0284c7);

      const clockAndSlogan = createWallClockAndSlogan(
        currentBuildingSide === 'female' ? 'CHÀO MỪNG NGÀY HỘI TRI ÂN 20/11' : 'TIÊN HỌC LỄ • HẬU HỌC VĂN',
        theme.signBg
      );
      clockAndSlogan.position.set(0, 3.38, -5.84);
      classroomGroup.add(clockAndSlogan);

      const boardTex = makeCanvasTexture('board_101_' + currentBuildingSide, 1024, 384, (ctx, w, h) => {
        ctx.fillStyle = '#064e3b';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 14;
        ctx.strokeRect(8, 8, w - 16, h - 16);
        ctx.fillStyle = '#fef9c3';
        ctx.font = '800 44px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          currentBuildingSide === 'female' ? 'TRANG TRÍ LỚP CHÀO MỪNG 20/11' : 'CHÀO MỪNG NGÀY NHÀ GIÁO VIỆT NAM 20/11',
          w / 2,
          120
        );
        ctx.fillStyle = '#a7f3d0';
        ctx.font = '600 28px Inter, sans-serif';
        ctx.fillText('“Tôn Sư Trọng Đạo — Uống Nước Nhớ Nguồn”', w / 2, 210);
      });
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(5.6, 1.95, 0.1),
        new THREE.MeshBasicMaterial({ map: boardTex })
      );
      board.position.set(0, 1.95, -5.78);
      board.userData = { interactiveType: 'chalkboard_wish' };
      classroomGroup.add(board);
      addClassroomBoardTrim(classroomGroup,board,5.6,1.95,false);
      room101BoardMesh = board;
      if (room101SavedWishes.length > 0) {
        updateRoom101ChalkboardWish(room101SavedWishes[room101SavedWishes.length - 1]);
      }

      if (currentBuildingSide === 'female') {
        const festiveClearance=createSceneClearancePlanner(14,12);
        festiveClearance.reserve('teacher platform',0,-4.65,3.2,1.85,0.05);
        festiveClearance.reserve('class exit',0,5.15,2.35,0.75,0.04);
        // Festive balloons & triangle bunting garlands
        for (let b = 0; b < 18; b++) {
          const balloon = new THREE.Mesh(
            new THREE.SphereGeometry(0.24, 14, 14),
            new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.25 })
          );
          balloon.position.set(-5.4 + (b % 9) * 1.35, 3.25 - Math.floor(b / 9) * 0.25, -4.4 + Math.floor(b / 9) * 6.8);
          balloon.userData = { isDecorBalloon: true, colorIdx: b };
          classroomGroup.add(balloon);
        }

        const flagColors = [0xf43f5e, 0xfacc15, 0x38bdf8, 0xa855f7, 0x10b981];
        for (let f = -5.2; f <= 5.2; f += 0.65) {
          const tri = new THREE.Mesh(
            new THREE.ConeGeometry(0.16, 0.34, 3),
            new THREE.MeshStandardMaterial({ color: flagColors[Math.abs(Math.round(f * 2)) % flagColors.length], roughness: 0.4 })
          );
          tri.rotation.x = Math.PI;
          tri.position.set(f, 3.45 - Math.cos((f / 5.2) * (Math.PI / 2)) * 0.28, -2.2);
          classroomGroup.add(tri);
        }

        // Student desks & chairs arranged in festive classroom groups
        [[-3.2, -1.6], [3.2, -1.6], [-3.2, 1.4], [3.2, 1.4]].forEach(([dx, dz]) => {
          const dGroup = createStudentDeskAndChair(true, true);
          const seatCluster=festiveClearance.find('student desk cluster',dx,dz+0.19,1.72,1.24,0.10,0.4);
          if(!seatCluster)return;
          dGroup.position.set(seatCluster.x,0,seatCluster.z-0.19);
          classroomGroup.add(dGroup);
          registerCollider(seatCluster.x,seatCluster.z,1.76,1.28,0.12);
        });

        // Central gift & floral arrangement table
        const centerTable = new THREE.Mesh(
          new THREE.BoxGeometry(1.8, 0.74, 1.0),
          getProceduralPBRMaterial('wood', 0xb45309, 0.4)
        );
        festiveClearance.reserve('central flower table',0,-0.2,1.8,1.0,0.10);
        centerTable.position.set(0, 0.37, -0.2);
        addPrecisionEdge(centerTable,0x56361f,0.24);
        classroomGroup.add(centerTable);
        registerCollider(0,-0.2,1.8,1.0,0.16);

        const centerVase = createFlowerVase(0xf43f5e);
        centerVase.position.set(0, 0.74, -0.2);
        classroomGroup.add(centerVase);

        // 6 lively students decorating the room
        [
          { x: -2.6, z: -2.5, rotY: 0.4, gender: 'female', shirt: 0xfce7f3, flower: true },
          { x: 2.6, z: -2.5, rotY: -0.4, gender: 'male', shirt: 0xffffff, flower: false },
          { x: -1.35, z: -0.2, rotY: Math.PI / 2, gender: 'female', shirt: 0xffffff, flower: true },
          { x: 1.35, z: -0.2, rotY: -Math.PI / 2, gender: 'female', shirt: 0xfce7f3, flower: false },
          { x: -2.8, z: 2.3, rotY: Math.PI, gender: 'male', shirt: 0xffffff, flower: false },
          { x: 2.8, z: 2.3, rotY: Math.PI, gender: 'female', shirt: 0xfce7f3, flower: true }
        ].forEach((stCfg, idx) => {
          const st = createRealisticHuman({
            gender: stCfg.gender,
            role: 'student',
            shirtColor: stCfg.shirt,
            hasBouquet: stCfg.flower
          });
          const spot=festiveClearance.find(
            'festive student '+idx,stCfg.x,stCfg.z,0.58,0.58,0.13,1.15);
          if(!spot)return;
          st.position.set(spot.x,0,spot.z);
          registerCollider(spot.x,spot.z,0.52,0.52,0.13);
          st.rotation.y = stCfg.rotY;
          st.traverse((c) => {
            if (c.isMesh) c.userData.interactiveType = 'talk_decor_student';
          });
          classroomGroup.add(st);
          pinkRoom101Students.push({ mesh: st, phase: idx * 1.1 });
        });
      } else {
        room101Teacher = createRealisticHuman({
          gender: theme.teacherGender,
          role: 'teacher',
          shirtColor: theme.teacherShirt
        });
        room101Teacher.position.set(0, 0.16, -4.5);
        room101Teacher.traverse((c) => {
          if (c.isMesh) c.userData.interactiveType = 'gift_teacher_101';
        });
        classroomGroup.add(room101Teacher);
        registerCollider(1.55,-4.55,1.75,0.78,0.16);

        // Two banks of double desks leave a real 3.6 m central procession aisle.
        // 2 columns x 3 rows x 2 seats = 12, with correct seated positions.
        [-2.7, 2.7].forEach((dx, colIdx) => {
          [-2.4, -0.15, 2.1].forEach((dz, rowIdx) => {
            const deskAndChair = createStudentDeskAndChair(true, true);
            deskAndChair.position.set(dx, 0, dz);
            classroomGroup.add(deskAndChair);
            registerCollider(dx,dz+0.22,1.75,1.28,0.18);

            [-0.38, 0.38].forEach((seatOffX, seatIdx) => {
              const st = createRealisticHuman({
                gender: (colIdx + rowIdx + seatIdx) % 2 === 0 ? 'female' : 'male',
                role: 'student',
                isSeated: true
              });
              // Seat center is desk position + 0.46m; don't offset the torso from its chair.
              st.position.set(dx + seatOffX, 0, dz + 0.46);
              st.rotation.y = Math.PI;
              classroomGroup.add(st);
              room101SeatedStudents.push({ mesh: st, phase: colIdx + rowIdx + seatIdx });
            });
          });
        });
      }

      roomHero = setProtagonistPose('walking', currentBuildingSide === 'teacher');
      roomHero.position.set(0, 0, 4.4);
      roomHero.rotation.y = Math.PI;
      classroomGroup.add(roomHero);

      classroomGroup.traverse((o) => {
        if (o.isMesh && o.userData && o.userData.interactiveType) interactiveList.push(o);
      });
    }

    function buildRoom102() {
      const theme = getActiveBuildingTheme();
      while (classroomGroup.children.length > 0) classroomGroup.remove(classroomGroup.children[0]);

      buildRoomShell(classroomGroup, { width: 14, depth: 12, height: 3.8, exitType: 'exit_to_hallway1' });
      addTeacherPodiumAndFurniture(classroomGroup, currentBuildingSide === 'female' ? 0xdb2777 : 0x0284c7);
      const clearance=createSceneClearancePlanner(14,12);
      clearance.reserve('teacher platform',0,-4.65,3.2,1.85,0.06);
      clearance.reserve('classroom door',0,5.15,2.4,0.75,0.04);

      const clockAndSlogan = createWallClockAndSlogan('TIẾT HỌC TRI ÂN CHÀO MỪNG 20/11', theme.signBg);
      clockAndSlogan.position.set(0, 3.43, -5.84);
      classroomGroup.add(clockAndSlogan);

      // Ceiling-mounted projector
      const projRod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.55, 8),
        new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 })
      );
      projRod.position.set(0, 3.52, -1.8);
      const projBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.14, 0.38),
        new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 })
      );
      projBody.position.set(0, 3.22, -1.8);
      classroomGroup.add(projRod, projBody);

      // Slides are directly touchable on the classroom board (no modal).
      room102SlideMesh = new THREE.Mesh(
        new THREE.BoxGeometry(5.0, 2.25, 0.09),
        new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
      );
      room102SlideMesh.position.set(0.45, 1.95, -5.8);
      room102SlideMesh.userData.interactiveType = 'room102_slide_touch';
      classroomGroup.add(room102SlideMesh);
      addClassroomBoardTrim(classroomGroup,room102SlideMesh,5.0,2.25,true);
      initRoom102Slides();

      const magSign = createSignBoard('BÁO TƯỜNG TRI ÂN 20/11', '#881337', '#fda4af', '#fff1f2', 2.4, 1.55);
      magSign.position.set(-4.35, 1.95, -5.78);
      magSign.traverse((c) => {
        if (c.isMesh) c.userData.interactiveType = 'open_wall_newspaper';
      });
      classroomGroup.add(magSign);

      // Digital classroom: two realistic banks of desks and a clear central aisle.
      [-2.7, 2.7].forEach((dx, colIdx) => {
        [-1.8, 0.4, 2.4].forEach((dz, rowIdx) => {
          const deskAndChair = createStudentDeskAndChair(true, true);
          // Seated bodies and chairs are an intentional assembly, so reserve
          // a combined footprint instead of separating the components.
          clearance.reserve('desk and seats',dx,dz+0.22,1.75,1.28,0.10);
          deskAndChair.position.set(dx, 0, dz);
          classroomGroup.add(deskAndChair);
          registerCollider(dx,dz+0.22,1.75,1.28,0.18);
          if (rowIdx < 2) {
            const st = createRealisticHuman({
              gender: (colIdx + rowIdx) % 2 === 0 ? 'female' : 'male',
              role: 'student',
              isSeated: true
            });
            st.position.set(dx - 0.36, 0, dz + 0.46);
            st.rotation.y = Math.PI;
            classroomGroup.add(st);
            activeIdleCharacters.push({ mesh: st, phase: colIdx + rowIdx * 1.4 });
          }
        });
      });

      if (currentBuildingSide === 'female') {
        for (let b = 0; b < 14; b++) {
          const balloon = new THREE.Mesh(
            new THREE.SphereGeometry(0.24, 14, 14),
            new THREE.MeshStandardMaterial({ color: 0xa855f7, roughness: 0.25 })
          );
          balloon.position.set(-4.8 + b * 0.78, 3.25, -3.6 + (b % 3) * 2.5);
          balloon.userData = { isDecorBalloon: true, colorIdx: b };
          classroomGroup.add(balloon);
        }
      } else {
        room102Teacher = createRealisticHuman({
          gender: theme.teacherGender,
          role: 'teacher',
          shirtColor: theme.teacherShirt
        });
        const teacherSpot=clearance.find('room102 teacher',-2.3,-4.4,0.58,0.58,0.12);
        if(teacherSpot){
          room102Teacher.position.set(teacherSpot.x,0.16,teacherSpot.z);
          registerCollider(teacherSpot.x,teacherSpot.z,0.55,0.55,0.10);
        }else room102Teacher.position.set(-2.3,0.16,-4.4);
        classroomGroup.add(room102Teacher);
        activeIdleCharacters.push({ mesh: room102Teacher, phase: 0.6 });
      }

      roomHero = setProtagonistPose('walking', true);
      roomHero.position.set(0, 0, 4.4);
      roomHero.rotation.y = Math.PI;
      classroomGroup.add(roomHero);

      classroomGroup.traverse((o) => {
        if (o.isMesh && o.userData && o.userData.interactiveType) interactiveList.push(o);
      });
    }


    function makeAnthologyCoverTexture(index) {
      const canvas=document.createElement('canvas');
      canvas.width=512;canvas.height=640;
      const c=canvas.getContext('2d');
      const colors=['#7f1d1d','#075985','#166534','#92400e','#581c87'];
      c.fillStyle=colors[index%5];
      c.fillRect(0,0,512,640);
      c.fillStyle='rgba(253,230,138,0.86)';
      c.fillRect(26,28,460,4);c.fillRect(26,605,460,4);
      c.fillRect(27,30,4,580);c.fillRect(481,30,4,580);
      c.strokeStyle='rgba(255,240,200,0.3)';
      c.lineWidth=2;
      for(let r=0;r<5;r++){
        c.beginPath();c.arc(256,312,105+r*23,Math.PI*1.15,Math.PI*1.85);c.stroke();
      }
      c.textAlign='center';c.fillStyle='#fef3c7';
      c.font='700 27px Georgia,serif';c.fillText('TẬP SAN TRI ÂN',256,128);
      c.font='bold 78px Georgia,serif';c.fillText(String(index+1).padStart(2,'0'),256,263);
      c.font='bold 32px Arial,sans-serif';
      const name=ANTHOLOGY_BOOKS[index].name.split(': ')[1]||ANTHOLOGY_BOOKS[index].name;
      const words=name.split(/\s+/),lines=[];let line='';
      words.forEach(word=>{
        const candidate=line?line+' '+word:word;
        if(line && c.measureText(candidate).width>400){lines.push(line);line=word;}
        else line=candidate;
      });
      if(line)lines.push(line);
      lines.slice(0,4).forEach((text,i)=>c.fillText(text,256,375+i*43));
      c.font='700 23px Arial,sans-serif';
      c.fillText('20 NOVEMBER  •  ẤN BẢN KỶ NIỆM',256,569);
      const tex=new THREE.CanvasTexture(canvas);
      tex.encoding=THREE.sRGBEncoding;
      tex.anisotropy=renderer?.capabilities?.getMaxAnisotropy?.()||1;
      return tex;
    }

    function createGalleryAnthologyModel(index) {
      const colors=[0x991b1b,0x075985,0x166534,0x92400e,0x6b21a8];
      const coverMat=new THREE.MeshStandardMaterial({color:colors[index%5],roughness:0.76});
      const pagesMat=new THREE.MeshStandardMaterial({color:0xfff6df,roughness:0.95});
      const trimMat=new THREE.MeshStandardMaterial({color:0xd6b974,metalness:0.32,roughness:0.54});
      const group=new THREE.Group();
      function addBox(w,h,d,x,y,z,mat){
        const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
        mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;
        mesh.userData.interactiveType='open_anthology';
        mesh.userData.bookIndex=index;
        if(y>=0.1 && h<0.06)addPrecisionEdge(mesh,0xf6d794,0.26);
        group.add(mesh);return mesh;
      }
      addBox(0.68,0.045,0.51,0,0,0,coverMat);
      addBox(0.63,0.092,0.46,0,0.051,0,pagesMat);
      addBox(0.68,0.032,0.51,0,0.112,0,coverMat);
      addBox(0.048,0.12,0.51,-0.32,0.056,0,trimMat);
      for(let i=0;i<5;i++)
        addBox(0.57,0.002,0.45,0,0.016+i*0.018,0,pagesMat);
      const top=new THREE.Mesh(new THREE.PlaneGeometry(0.62,0.46),
        new THREE.MeshBasicMaterial({map:makeAnthologyCoverTexture(index),side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
      top.rotation.x=-Math.PI/2;
      top.position.set(0,0.141,0);
      top.userData={interactiveType:'open_anthology',bookIndex:index};
      group.add(top);
      const glint=new THREE.Mesh(new THREE.BoxGeometry(0.008,0.008,0.48),trimMat);
      glint.position.set(0.302,0.13,0);group.add(glint);
      return group;
    }

    function createHandheldReadingBook() {
      const group=new THREE.Group();
      const cover=new THREE.MeshStandardMaterial({color:0x7c2d12,roughness:0.75,side:THREE.DoubleSide});
      const paper=new THREE.MeshStandardMaterial({color:0xfff4d6,roughness:0.91,side:THREE.DoubleSide});
      const ink=new THREE.MeshStandardMaterial({color:0xb6a58d,roughness:1});
      // Two open covers and real page stacks, hinged at the spine.
      [-0.14,0.14].forEach((x,side)=>{
        const back=new THREE.Mesh(new THREE.BoxGeometry(0.29,0.018,0.38),cover);
        back.position.set(x,-0.018,0);
        group.add(back);
        const pile=new THREE.Mesh(new THREE.BoxGeometry(0.278,0.024,0.355),paper);
        pile.position.set(x,0,0);pile.receiveShadow=true;group.add(pile);
        for(let l=0;l<5;l++){
          const line=new THREE.Mesh(new THREE.BoxGeometry(0.20,0.0007,0.006),ink);
          line.position.set(x,0.016,-0.12+l*0.053);group.add(line);
        }
      });
      const spine=new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.018,0.38,10),cover);
      spine.rotation.x=Math.PI/2;spine.position.y=-0.025;group.add(spine);
      const hinge=new THREE.Group();
      const leaf=new THREE.Mesh(new THREE.BoxGeometry(0.274,0.002,0.356),paper);
      leaf.position.x=0.137;hinge.add(leaf);hinge.position.y=0.02;group.add(hinge);
      group.userData.leaf=hinge;
      return group;
    }

    function beginRoom103PageTurn(direction=1) {
      if(sceneMode!=='room103'||!room103ReaderBook) return;
      room103PageTurn={time:0,duration:0.78,direction:Math.sign(direction)||1};
      room103LastAutoTurn=0;
    }

    function animateRoom103Reader(dt,elapsed) {
      if(sceneMode!=='room103'||!room103Reader||!room103ReaderBook)return;
      const data=room103Reader.userData||{};
      const nod=Math.sin(elapsed*1.22)*0.026;
      if(data.headGroup) data.headGroup.rotation.x=0.21+nod;
      if(data.leftArm) {
        data.leftArm.rotation.x=-0.73+nod*0.4;
        data.leftArm.rotation.z=-0.25;
      }
      if(data.rightArm) {
        data.rightArm.rotation.x=-0.78+nod*0.55;
        data.rightArm.rotation.z=0.21;
      }
      room103ReaderBook.position.y=1.035+Math.sin(elapsed*1.5)*0.008;
      room103ReaderBook.rotation.x=-0.16+Math.sin(elapsed*0.72)*0.014;
      const leaf=room103ReaderBook.userData.leaf;
      if(room103PageTurn){
        const g=room103PageTurn;
        g.time=Math.min(g.duration,g.time+dt);
        const t=smooth01(g.time/g.duration);
        if(leaf)leaf.rotation.z=g.direction*Math.PI*t;
        if(data.rightArm) data.rightArm.rotation.x=-0.78-Math.sin(t*Math.PI)*0.28;
        if(t>=1){room103PageTurn=null;if(leaf)leaf.rotation.z=0;}
      }else{
        room103LastAutoTurn+=dt;
        if(room103LastAutoTurn>11.5) beginRoom103PageTurn(1);
      }
    }

    function buildRoom103() {
      while (classroomGroup.children.length > 0) classroomGroup.remove(classroomGroup.children[0]);

      buildRoomShell(classroomGroup, {
        width: 14,
        depth: 12,
        height: 3.8,
        exitType: 'exit_to_hallway1',
        floorType: 'wood',
        floorColor: 0x92400e,
        withWindows: false
      });

      const titleSign = createSignBoard(
        currentBuildingSide === 'female' ? 'GÓC SÁNG TẠO & TẬP SAN 20/11' : 'TRIỂN LÃM TRANH & 5 TẬP SAN 20/11',
        '#78350f',
        '#facc15',
        '#fef9c3',
        6.4,
        0.58
      );
      titleSign.position.set(0, 3.28, -5.82);
      classroomGroup.add(titleSign);

      const clearance=createSceneClearancePlanner(14,12);
      // Keep the main entrance unobstructed; only freestanding elements compete
      // for floor space. Wall-mounted artwork is intentionally excluded.
      clearance.reserve('main entrance',0,5.18,2.4,0.68,0.08);
      // Decorative red carpet runner & velvet benches & plants
      const runner = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.02, 8.6),
        new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.72 })
      );
      runner.position.set(0, 0.01, -0.4);
      classroomGroup.add(runner);

      [[-5.8, -5.0], [5.8, -5.0], [-5.8, 4.8], [5.8, 4.8]].forEach(([px, pz]) => {
        const plant = createPottedIndoorPlant(1.05);
        const spot=clearance.find('plant',px,pz,0.62,0.62,0.08);
        if(!spot)return;
        plant.position.set(spot.x,0,spot.z);
        classroomGroup.add(plant);
        registerCollider(spot.x,spot.z,0.56,0.56,0.10);
      });

      [-2.2, 2.2].forEach((bx) => {
        const bench = createWoodenBench(2.0);
        const spot=clearance.find('gallery bench',bx,1.8,2.05,0.50,0.10);
        if(!spot)return;
        bench.position.set(spot.x,0,spot.z);
        classroomGroup.add(bench);
        registerCollider(spot.x,spot.z,2.00,0.46,0.12);
      });

      const spots = [
        { x: -6.82, z: -3.2, rotY: Math.PI / 2, idx: 0 },
        { x: -6.82, z: 0, rotY: Math.PI / 2, idx: 1 },
        { x: -6.82, z: 3.2, rotY: Math.PI / 2, idx: 2 },
        { x: 6.82, z: -3.2, rotY: -Math.PI / 2, idx: 3 },
        { x: 6.82, z: 0, rotY: -Math.PI / 2, idx: 4 },
        { x: 6.82, z: 3.2, rotY: -Math.PI / 2, idx: 5 }
      ];
      spots.forEach((sp) => {
        const art = GALLERY_ARTWORKS[sp.idx];
        const tex = new THREE.TextureLoader().load(createArtCanvasDataURL(art));
        tex.encoding = THREE.sRGBEncoding;
        const frame = new THREE.Mesh(
          new THREE.BoxGeometry(2.2, 1.5, 0.1),
          new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.4 })
        );
        frame.position.set(sp.x, 1.9, sp.z);
        frame.rotation.y = sp.rotY;
        const canvasPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(2.02, 1.34),
          new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
        );
        canvasPlane.position.z = 0.075;
        canvasPlane.userData = { interactiveType: 'view_artwork', artIndex: sp.idx };
        frame.add(canvasPlane);
        classroomGroup.add(frame);
      });

      const pedMat = getProceduralPBRMaterial('wood', 0x78350f, 0.4);
      for(let b=0;b<ANTHOLOGY_BOOKS.length;b++){
        const px=-4.2+b*2.1;
        const ped = new THREE.Mesh(new THREE.BoxGeometry(0.95,1.0,0.8),pedMat);
        const pedSpot=clearance.find('anthology pedestal '+b,px,-1.6,0.95,0.80,0.13);
        if(!pedSpot)continue;
        ped.position.set(pedSpot.x,0.5,pedSpot.z);
        ped.castShadow=true;
        classroomGroup.add(ped);
        registerCollider(pedSpot.x,pedSpot.z,0.95,0.8,0.14);
        const nameplate=createGalleryAnthologyModel(b);
        nameplate.position.set(pedSpot.x,1.075,pedSpot.z);
        nameplate.rotation.y = -0.12 + 0.06*b;
        classroomGroup.add(nameplate);
      }

      // Reading corner: a student holds an opened book, follows each line
      // with their gaze and turns a physical page on a regular interval.
      room103Reader = createRealisticHuman({
        gender:'female',role:'reader',shirtColor:0xf8fafc,
        hairColor:0x1c1917,hasBouquet:false
      });
      const readerSpot=clearance.find('reading student',0.3,-3.45,0.68,0.66,0.17);
      if(readerSpot){
        room103Reader.position.set(readerSpot.x,0,readerSpot.z);
        registerCollider(readerSpot.x,readerSpot.z,0.62,0.58,0.15);
      } else room103Reader.position.set(0.3,0,-3.45);
      room103Reader.rotation.y=0;
      classroomGroup.add(room103Reader);
      room103ReaderBook=createHandheldReadingBook();
      room103ReaderBook.userData.keepWithEnhanced=true;
      room103ReaderBook.position.set(0,1.02,0.34);
      room103ReaderBook.rotation.x=-0.16;
      room103Reader.add(room103ReaderBook);
      room103LastAutoTurn=0;
      room103PageTurn=null;

      // 3 Gallery Visitors admiring paintings & anthologies
      [
        { x: -4.4, z: -2.8, rotY: -Math.PI / 2, gender: 'female', shirt: 0xffffff },
        { x: 4.4, z: 0.2, rotY: Math.PI / 2, gender: 'male', shirt: 0xffffff },
        { x: -2.45, z: -3.15, rotY: 0.15, gender: 'female', shirt: 0xfce7f3 }
      ].forEach((v, idx) => {
        const visitor = createRealisticHuman({ gender: v.gender, role: 'student', shirtColor: v.shirt });
        const spot=clearance.find('gallery visitor '+idx,v.x,v.z,0.64,0.68,0.16);
        if(!spot)return;
        visitor.position.set(spot.x,0,spot.z);
        registerCollider(spot.x,spot.z,0.59,0.59,0.15);
        visitor.rotation.y = v.rotY;
        classroomGroup.add(visitor);
        activeIdleCharacters.push({ mesh: visitor, phase: idx * 1.2 });
      });

      roomHero = setProtagonistPose('walking', true);
      roomHero.position.set(0, 0, 4.4);
      roomHero.rotation.y = Math.PI;
      classroomGroup.add(roomHero);

      classroomGroup.traverse((o) => {
        if (o.isMesh && o.userData && o.userData.interactiveType) interactiveList.push(o);
      });
    }

    // =========================================================================
    // 8. FLOOR 2: HALLWAY 2, ROOM 201 & ROOM 202
    // =========================================================================
    function buildHallway2() {
      const theme = getActiveBuildingTheme();
      while (hallway2Group.children.length > 0) hallway2Group.remove(hallway2Group.children[0]);

      buildHallwayCorridorShell(hallway2Group, 0xe2e8f0, 2);

      const banner = createSignBoard(`${theme.buildingName.toUpperCase()} • TẦNG 2`, theme.signBg, theme.signBorder, '#ffffff', 5.8, 0.56);
      banner.position.set(0, 3.45, -3.45);
      hallway2Group.add(banner);

      createHallwayStairLayout(hallway2Group, 2);

      const d201 = createModernDoubleDoor(
        -6.8,
        -3.38,
        'enter_201',
        currentBuildingSide === 'female' ? 'PHÒNG 201 • HỌP HỘI ĐỒNG' : 'HỘI TRƯỜNG 201 • VĂN NGHỆ'
      );
      const d202 = createModernDoubleDoor(
        6.8,
        -3.38,
        'enter_202',
        currentBuildingSide === 'female' ? 'PHÒNG 202 • VINH DANH' : 'HỘI TRƯỜNG 202 • PHÓNG SỰ'
      );
      hallway2Group.add(d201.group, d202.group);
      hallway2Group.userData.doors = { enter_201: d201.pivots, enter_202: d202.pivots };

      roomHero = setProtagonistPose('walking', true);
      placeHallwayAvatar(roomHero);
      roomHero.rotation.y = Math.PI;
      hallway2Group.add(roomHero);

      hallway2Group.traverse((o) => {
        if (o.isMesh && o.userData && o.userData.interactiveType) interactiveList.push(o);
      });
    }

    function buildRoom201() {
      while (auditoriumGroup.children.length > 0) auditoriumGroup.remove(auditoriumGroup.children[0]);
      room201Performers = [];
      room201Audience = [];
      pinkRoom201Teachers = [];

      if (currentBuildingSide === 'female') {
        buildRoomShell(auditoriumGroup, { width: 16, depth: 14, height: 4.2, exitType: 'exit_to_hallway2', floorType: 'wood', floorColor: 0x78350f });

        const screen = createSignBoard('HỌP HỘI ĐỒNG SƯ PHẠM CHÀO MỪNG 20/11', '#831843', '#facc15', '#fef08a', 7.2, 1.55);
        screen.position.set(0, 2.4, -6.8);
        auditoriumGroup.add(screen);

        const confTable = new THREE.Mesh(
          new THREE.BoxGeometry(9.4, 0.14, 2.8),
          getProceduralPBRMaterial('wood', 0x451a03, 0.3, 0.15)
        );
        confTable.position.set(0, 0.78, -0.8);
        confTable.castShadow = true;
        auditoriumGroup.add(confTable);

        const tableBase = new THREE.Mesh(
          new THREE.BoxGeometry(7.6, 0.72, 1.4),
          getProceduralPBRMaterial('wood', 0x78350f, 0.45)
        );
        tableBase.position.set(0, 0.36, -0.8);
        auditoriumGroup.add(tableBase);

        [-2.2, 0, 2.2].forEach((vx) => {
          const vase = createFlowerVase(0xdb2777);
          vase.position.set(vx, 0.85, -0.8);
          auditoriumGroup.add(vase);
        });

        [[-6.8, -5.8], [6.8, -5.8], [-6.8, 5.6], [6.8, 5.6]].forEach(([px, pz]) => {
          const plant = createPottedIndoorPlant(1.05);
          plant.position.set(px, 0, pz);
          auditoriumGroup.add(plant);
        });

        const shelfR = createBookshelfWithBooks(0xdb2777);
        shelfR.position.set(7.45, 0, -2.2);
        shelfR.rotation.y = -Math.PI / 2;
        auditoriumGroup.add(shelfR);

        const chairMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4 });
        const teacherList = [
          { name: 'Thầy A • Hiệu Trưởng', x: 0, z: -2.55, rotY: 0, gender: 'male', color: 0x1e3a8a },
          { name: 'Cô B • Phó Hiệu Trưởng', x: -2.8, z: -2.55, rotY: 0, gender: 'female', color: 0xbe185d },
          { name: 'Thầy C • Chủ Tịch Công Đoàn', x: 2.8, z: -2.55, rotY: 0, gender: 'male', color: 0x0f766e },
          { name: 'Cô D • Tổ Trưởng Chuyên Môn', x: -2.8, z: 0.95, rotY: Math.PI, gender: 'female', color: 0x7c3aed },
          { name: 'Thầy E • Bí Thư Đoàn Trường', x: 2.8, z: 0.95, rotY: Math.PI, gender: 'male', color: 0xb45309 },
          { name: 'Cô F • Thư Ký Hội Đồng', x: 0, z: 0.95, rotY: Math.PI, gender: 'female', color: 0x0284c7 }
        ];
        teacherList.forEach((t, idx) => {
          const execChair = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.95, 0.54), chairMat);
          execChair.position.set(t.x, 0.48, t.z + (t.rotY === 0 ? -0.14 : 0.14));
          auditoriumGroup.add(execChair);

          const mesh = createRealisticHuman({ gender: t.gender, role: 'teacher', shirtColor: t.color, isSeated: true });
          mesh.position.set(t.x, 0, t.z);
          mesh.rotation.y = t.rotY;
          mesh.traverse((c) => {
            if (c.isMesh) {
              c.userData.interactiveType = 'greet_boardroom_teacher';
              c.userData.teacherLabel = t.name;
            }
          });
          auditoriumGroup.add(mesh);
          pinkRoom201Teachers.push({ mesh, phase: idx * 0.9 });
        });
      } else {
        buildRoomShell(auditoriumGroup, { width: 18, depth: 16, height: 4.8, exitType: 'exit_to_hallway2', floorType: 'wood', floorColor: 0x78350f });

        const stage = new THREE.Mesh(
          new THREE.BoxGeometry(13.2, 0.65, 5.0),
          getProceduralPBRMaterial('wood', 0x451a03, 0.35)
        );
        stage.position.set(0, 0.325, -5.2);
        stage.receiveShadow = true;
        auditoriumGroup.add(stage);

        // Crimson velvet stage curtains & top valance
        const velvetMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.65 });
        [-6.2, 6.2].forEach((cx) => {
          const sideCurtain = new THREE.Mesh(new THREE.BoxGeometry(1.1, 3.8, 0.45), velvetMat);
          sideCurtain.position.set(cx, 2.55, -7.4);
          auditoriumGroup.add(sideCurtain);
        });
        const topValance = new THREE.Mesh(new THREE.BoxGeometry(13.4, 0.55, 0.5), velvetMat);
        topValance.position.set(0, 4.35, -7.4);
        auditoriumGroup.add(topValance);

        // Stage front flower arrangements & speakers
        [-5.6, 5.6].forEach((sx) => {
          const speaker = new THREE.Mesh(
            new THREE.BoxGeometry(0.65, 1.15, 0.55),
            new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 })
          );
          speaker.position.set(sx, 1.22, -3.1);
          auditoriumGroup.add(speaker);
        });
        [-3.2, -1.1, 1.1, 3.2].forEach((fx) => {
          const stageVase = createFlowerVase(0xfacc15);
          stageVase.position.set(fx, 0.65, -2.9);
          auditoriumGroup.add(stageVase);
        });

        const backdrop = createSignBoard('CHƯƠNG TRÌNH VĂN NGHỆ TRI ÂN THẦY CÔ 20/11', '#7f1d1d', '#facc15', '#fef08a', 9.6, 1.85);
        backdrop.position.set(0, 2.75, -7.75);
        auditoriumGroup.add(backdrop);

        const mcPodium = new THREE.Mesh(
          new THREE.BoxGeometry(0.95, 1.15, 0.7),
          getProceduralPBRMaterial('wood', 0x92400e, 0.4)
        );
        mcPodium.position.set(-4.6, 1.22, -3.6);
        auditoriumGroup.add(mcPodium);

        const mc = createRealisticHuman({ gender: 'female', role: 'mc', shirtColor: 0xe11d48 });
        mc.position.set(-4.6, 0.65, -4.2);
        auditoriumGroup.add(mc);

        [-2.4, -0.8, 0.8, 2.4].forEach((px, idx) => {
          const p = createRealisticHuman({
            gender: idx % 2 === 0 ? 'female' : 'male',
            role: 'student',
            shirtColor: idx % 2 === 0 ? 0xf43f5e : 0x0284c7
          });
          p.position.set(px, 0.65, -5.2);
          auditoriumGroup.add(p);
          room201Performers.push(p);
        });

        // Auditorium Theater Seats + Seated Teachers & Students
        const theaterSeatMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.55 });
        [-4.2, -1.4, 1.4, 4.2].forEach((ax, idx) => {
          [-1.2, 1.2, 3.4].forEach((az, rowIdx) => {
            const seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.44, 0.55), theaterSeatMat);
            seatBase.position.set(ax, 0.22, az + 0.08);
            const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.92, 0.14), theaterSeatMat);
            seatBack.position.set(ax, 0.46, az + 0.34);
            auditoriumGroup.add(seatBase, seatBack);

            if (rowIdx === 0) {
              const tAud = createRealisticHuman({
                gender: idx % 2 === 0 ? 'male' : 'female',
                role: 'teacher',
                shirtColor: idx % 2 === 0 ? 0x1e3a8a : 0xbe185d,
                isSeated: true
              });
              tAud.position.set(ax, 0, az);
              tAud.rotation.y = Math.PI;
              auditoriumGroup.add(tAud);
              room201Audience.push({ mesh: tAud, phase: idx, isTeacher: true });
            } else if (rowIdx === 1 || (rowIdx === 2 && idx !== 1 && idx !== 2)) {
              const sAud = createRealisticHuman({ gender: (idx + rowIdx) % 2 === 0 ? 'female' : 'male', role: 'student', isSeated: true });
              sAud.position.set(ax, 0, az);
              sAud.rotation.y = Math.PI;
              auditoriumGroup.add(sAud);
              room201Audience.push({ mesh: sAud, phase: idx + rowIdx * 2, isTeacher: false });
            }
          });
        });
      }

      roomHero = setProtagonistPose('walking', true);
      roomHero.position.set(0, 0, 5.8);
      roomHero.rotation.y = Math.PI;
      auditoriumGroup.add(roomHero);

      auditoriumGroup.traverse((o) => {
        if (o.isMesh && o.userData && o.userData.interactiveType) interactiveList.push(o);
      });
    }

    function buildRoom202() {
      while (auditoriumGroup.children.length > 0) auditoriumGroup.remove(auditoriumGroup.children[0]);
      room202State = { waitingStudents: [], reporter: null, interviewee: null };

      if (currentBuildingSide === 'female') {
        buildRoomShell(auditoriumGroup, { width: 15, depth: 13, height: 3.9, exitType: 'exit_to_hallway2', floorType: 'wood', floorColor: 0x78350f });

        const banner = createSignBoard('PHÒNG TRUYỀN THỐNG • VINH DANH THẦY CÔ TIÊU BIỂU', '#831843', '#facc15', '#fef08a', 8.2, 0.72);
        banner.position.set(0, 3.35, -6.3);
        auditoriumGroup.add(banner);

        const carpet = new THREE.Mesh(
          new THREE.BoxGeometry(3.4, 0.02, 9.2),
          new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.7 })
        );
        carpet.position.set(0, 0.01, -0.4);
        auditoriumGroup.add(carpet);

        [[-6.2, -5.2], [6.2, -5.2], [-6.2, 5.0], [6.2, 5.0]].forEach(([px, pz]) => {
          const plant = createPottedIndoorPlant(1.0);
          plant.position.set(px, 0, pz);
          auditoriumGroup.add(plant);
        });

        [-2.4, 2.4].forEach((bx) => {
          const bench = createWoodenBench(1.9);
          bench.position.set(bx, 0, 1.8);
          auditoriumGroup.add(bench);
        });

        const honors = [
          { title: 'THẦY A', sub: 'Nhà Giáo Ưu Tú • Huy Chương Vì Sự Nghiệp GD', x: -4.8 },
          { title: 'CÔ B', sub: 'Chiến Sĩ Thi Đua Toàn Quốc • GV Dạy Giỏi', x: -1.6 },
          { title: 'THẦY C', sub: 'Cờ Thi Đua Xuất Sắc • Bồi Dưỡng HSG Quốc Gia', x: 1.6 },
          { title: 'CÔ D', sub: 'Huân Chương Lao Động • Tấm Gương Sáng Tạo', x: 4.8 }
        ];
        honors.forEach((h) => {
          const ped = new THREE.Mesh(
            new THREE.BoxGeometry(2.2, 0.55, 0.75),
            getProceduralPBRMaterial('wood', 0x451a03, 0.4)
          );
          ped.position.set(h.x, 0.275, -5.5);
          auditoriumGroup.add(ped);

          const cabinet = new THREE.Mesh(
            new THREE.BoxGeometry(2.15, 1.95, 0.68),
            new THREE.MeshPhysicalMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.35, roughness: 0.1 })
          );
          cabinet.position.set(h.x, 1.52, -5.5);
          cabinet.userData = { interactiveType: 'inspect_honor_plaque', honorTitle: `${h.title} — ${h.sub}` };
          auditoriumGroup.add(cabinet);

          const trophy = new THREE.Mesh(
            new THREE.CylinderGeometry(0.24, 0.14, 0.52, 14),
            new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.85, roughness: 0.2 })
          );
          trophy.position.set(h.x, 1.15, -5.5);
          auditoriumGroup.add(trophy);

          const plaque = createSignBoard(`${h.title}: ${h.sub}`, '#7f1d1d', '#facc15', '#fef08a', 2.35, 0.52);
          plaque.position.set(h.x, 2.82, -5.45);
          auditoriumGroup.add(plaque);
        });

        // Students admiring the Honor Hall
        [
          { x: -3.2, z: -3.5, rotY: Math.PI, gender: 'female', shirt: 0xffffff },
          { x: 3.2, z: -3.5, rotY: Math.PI, gender: 'male', shirt: 0xffffff },
          { x: 0, z: -2.8, rotY: Math.PI, gender: 'female', shirt: 0xfce7f3 }
        ].forEach((stCfg, idx) => {
          const st = createRealisticHuman({ gender: stCfg.gender, role: 'student', shirtColor: stCfg.shirt, hasBouquet: idx === 2 });
          st.position.set(stCfg.x, 0, stCfg.z);
          st.rotation.y = stCfg.rotY;
          auditoriumGroup.add(st);
          activeIdleCharacters.push({ mesh: st, phase: idx * 1.1 });
        });
      } else {
        buildRoomShell(auditoriumGroup, { width: 15, depth: 13, height: 3.9, exitType: 'exit_to_hallway2' });

        const tvWall = createSignBoard('TRƯỜNG QUAY PHÓNG SỰ TRI ÂN 20/11', '#0c4a6e', '#38bdf8', '#f0f9ff', 7.6, 1.45);
        tvWall.position.set(0, 2.4, -6.3);
        auditoriumGroup.add(tvWall);

        // Studio platform, floral coffee table, studio cameras & softbox lights
        const studioPlatform = new THREE.Mesh(
          new THREE.BoxGeometry(6.8, 0.14, 3.2),
          getProceduralPBRMaterial('wood', 0x78350f, 0.35)
        );
        studioPlatform.position.set(0, 0.07, -3.6);
        auditoriumGroup.add(studioPlatform);

        const coffeeTable = new THREE.Mesh(
          new THREE.BoxGeometry(1.4, 0.52, 0.7),
          getProceduralPBRMaterial('wood', 0xb45309, 0.35)
        );
        coffeeTable.position.set(0, 0.4, -3.2);
        auditoriumGroup.add(coffeeTable);

        const studioVase = createFlowerVase(0x0284c7);
        studioVase.position.set(0, 0.66, -3.2);
        auditoriumGroup.add(studioVase);

        // 2 Studio Cameras on Tripods + Softboxes
        const camMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.7, roughness: 0.3 });
        [-2.2, 2.2].forEach((cx, idx) => {
          const tripod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.28, 1.35, 10), camMat);
          tripod.position.set(cx, 0.68, -0.4);
          const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, 0.48), camMat);
          camBody.position.set(cx, 1.45, -0.4);
          camBody.rotation.y = idx === 0 ? -0.35 : 0.35;
          auditoriumGroup.add(tripod, camBody);

          const lightStand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.22, 2.1, 8), camMat);
          lightStand.position.set(cx * 2.1, 1.05, -2.0);
          const softbox = new THREE.Mesh(
            new THREE.BoxGeometry(0.65, 0.65, 0.2),
            new THREE.MeshBasicMaterial({ color: 0xfef9c3 })
          );
          softbox.position.set(cx * 2.1, 2.15, -2.0);
          softbox.rotation.y = idx === 0 ? -0.6 : 0.6;
          auditoriumGroup.add(lightStand, softbox);
        });

        const reporter = createRealisticHuman({ gender: 'female', role: 'mc', shirtColor: 0x0284c7 });
        reporter.position.set(-1.3, 0.14, -3.5);
        reporter.rotation.y = 0.45;
        auditoriumGroup.add(reporter);

        const interviewee = createRealisticHuman({ gender: 'male', role: 'teacher', shirtColor: 0x1e3a8a });
        interviewee.position.set(1.3, 0.14, -3.5);
        interviewee.rotation.y = -0.45;
        auditoriumGroup.add(interviewee);

        // Queue of 3 students holding bouquets waiting to share wishes on TV
        [-3.6, -2.6, -1.6].forEach((qz, idx) => {
          const waitSt = createRealisticHuman({
            gender: idx % 2 === 0 ? 'female' : 'male',
            role: 'student',
            hasBouquet: true
          });
          waitSt.position.set(-4.6, 0, qz);
          waitSt.rotation.y = Math.PI / 2;
          auditoriumGroup.add(waitSt);
          room202State.waitingStudents.push(waitSt);
          activeIdleCharacters.push({ mesh: waitSt, phase: idx * 0.9 });
        });

        room202State.reporter = reporter;
        room202State.interviewee = interviewee;
      }

      roomHero = setProtagonistPose('walking', true);
      roomHero.position.set(0, 0, 4.8);
      roomHero.rotation.y = Math.PI;
      auditoriumGroup.add(roomHero);

      auditoriumGroup.traverse((o) => {
        if (o.isMesh && o.userData && o.userData.interactiveType) interactiveList.push(o);
      });
    }

    // =========================================================================
    // 9. FLOOR 3: HALLWAY 3, ROOM 301 & ROOM 302
    // =========================================================================
    function buildHallway3() {
      const theme = getActiveBuildingTheme();
      while (hallway3Group.children.length > 0) hallway3Group.remove(hallway3Group.children[0]);

      buildHallwayCorridorShell(hallway3Group, 0xfef3c7, 3);

      const banner = createSignBoard(`${theme.buildingName.toUpperCase()} • TẦNG 3`, theme.signBg, theme.signBorder, '#ffffff', 5.8, 0.56);
      banner.position.set(0, 3.45, -3.45);
      hallway3Group.add(banner);

      createHallwayStairLayout(hallway3Group, 3);

      const d301 = createModernDoubleDoor(
        -6.8,
        -3.38,
        'enter_301',
        currentBuildingSide === 'female' ? 'PHÒNG 301 • TREO ẢNH & CHÚC' : 'PHÒNG 301 • KỶ VẬT TRI ÂN'
      );
      const d302 = createModernDoubleDoor(
        6.8,
        -3.38,
        'enter_302',
        currentBuildingSide === 'female' ? 'PHÒNG 302 • LỄ VẬT & CHỨNG NHẬN' : 'PHÒNG 302 • VƯỜN CÂY TRI ÂN'
      );
      hallway3Group.add(d301.group, d302.group);
      hallway3Group.userData.doors = { enter_301: d301.pivots, enter_302: d302.pivots };

      roomHero = setProtagonistPose('walking', true);
      placeHallwayAvatar(roomHero);
      roomHero.rotation.y = Math.PI;
      hallway3Group.add(roomHero);

      hallway3Group.traverse((o) => {
        if (o.isMesh && o.userData && o.userData.interactiveType) interactiveList.push(o);
      });
    }

    function buildRoom301() {
      const theme = getActiveBuildingTheme();
      while (floor3RoomGroup.children.length > 0) floor3RoomGroup.remove(floor3RoomGroup.children[0]);
      pink301Frames = [];

      buildRoomShell(floor3RoomGroup, {
        width: 15,
        depth: 13,
        height: 3.9,
        exitType: 'exit_to_hallway3',
        floorType: 'wood',
        floorColor: 0x78350f,
        withWindows: false
      });

      [[-6.2, -5.2], [6.2, -5.2], [-6.2, 5.0], [6.2, 5.0]].forEach(([px, pz]) => {
        const plant = createPottedIndoorPlant(1.0);
        plant.position.set(px, 0, pz);
        floor3RoomGroup.add(plant);
      });

      if (currentBuildingSide === 'female') {
        const banner = createSignBoard('PHÒNG TRANH 301 • TREO ẢNH & LỜI CHÚC KỶ NIỆM', '#831843', '#f472b6', '#ffffff', 7.8, 0.65);
        banner.position.set(0, 3.35, -6.3);
        floor3RoomGroup.add(banner);

        // Art tables with flower vases, benches & bookshelves
        [-3.4, 3.4].forEach((tx) => {
          const artTable = new THREE.Mesh(
            new THREE.BoxGeometry(2.4, 0.74, 1.0),
            getProceduralPBRMaterial('wood', 0xb45309, 0.4)
          );
          artTable.position.set(tx, 0.37, -1.6);
          floor3RoomGroup.add(artTable);

          const vase = createFlowerVase(0xdb2777);
          vase.position.set(tx, 0.74, -1.6);
          floor3RoomGroup.add(vase);
        });

        [-2.2, 2.2].forEach((bx) => {
          const bench = createWoodenBench(1.9);
          bench.position.set(bx, 0, 1.6);
          floor3RoomGroup.add(bench);
        });

        for (let i = 0; i < 4; i++) {
          const fx = -4.8 + i * 3.2;
          const frame = new THREE.Mesh(
            new THREE.BoxGeometry(2.3, 1.65, 0.12),
            new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.65, roughness: 0.25 })
          );
          frame.position.set(fx, 1.95, -6.28);

          const placeholderTex = makeCanvasTexture(`p301_slot_${i}`, 512, 360, (ctx, w, h) => {
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = '#f472b6';
            ctx.lineWidth = 8;
            ctx.strokeRect(12, 12, w - 24, h - 24);
            ctx.fillStyle = '#fbcfe8';
            ctx.font = '800 28px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`KHUNG TREO SỐ ${i + 1}`, w / 2, 155);
            ctx.fillStyle = '#fde047';
            ctx.font = '600 20px Inter, sans-serif';
            ctx.fillText('Nhấn để tải ảnh hoặc treo lời chúc', w / 2, 215);
          });

          const artMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(2.1, 1.45),
            new THREE.MeshBasicMaterial({ map: placeholderTex })
          );
          artMesh.position.z = 0.07;
          artMesh.userData = { interactiveType: 'open_pink301_modal', slotIndex: i };
          frame.add(artMesh);
          floor3RoomGroup.add(frame);
          pink301Frames.push(artMesh);
        }

        // 3 Students decorating & hanging frames
        [
          { x: -3.2, z: -4.2, rotY: Math.PI, gender: 'female', shirt: 0xfce7f3 },
          { x: 1.8, z: -4.2, rotY: Math.PI, gender: 'male', shirt: 0xffffff },
          { x: -1.5, z: 2.8, rotY: 0.4, gender: 'female', shirt: 0xffffff }
        ].forEach((s, idx) => {
          const st = createRealisticHuman({ gender: s.gender, role: 'student', shirtColor: s.shirt, hasBouquet: idx === 2 });
          st.position.set(s.x, 0, s.z);
          st.rotation.y = s.rotY;
          floor3RoomGroup.add(st);
          activeIdleCharacters.push({ mesh: st, phase: idx * 1.3 });
        });
      } else {
        const banner = createSignBoard('PHÒNG LƯU NIỆM & KỶ VẬT TRI ÂN 301', '#78350f', '#facc15', '#fef08a', 7.4, 0.65);
        banner.position.set(0, 3.35, -6.3);
        floor3RoomGroup.add(banner);

        // Reception table & 4 glass keepsake pedestals (fountain pen, chalk box, lesson notebook, medal)
        const recTable = new THREE.Mesh(
          new THREE.BoxGeometry(2.2, 0.78, 0.85),
          getProceduralPBRMaterial('wood', 0xb45309, 0.4)
        );
        recTable.position.set(2.1, 0.39, -4.4);
        floor3RoomGroup.add(recTable);
        registerCollider(2.1,-4.4,2.2,0.85,0.14);

        const recVase = createFlowerVase(0x0284c7);
        recVase.position.set(2.3, 0.78, -4.4);
        floor3RoomGroup.add(recVase);

        const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.36, roughness: 0.08 });
        [-3.6, -1.2, 1.2, 3.6].forEach((kx, kIdx) => {
          const ped = new THREE.Mesh(
            new THREE.BoxGeometry(1.1, 0.95, 0.9),
            getProceduralPBRMaterial('wood', 0x451a03, 0.4)
          );
          ped.position.set(kx, 0.475, -1.2);
          floor3RoomGroup.add(ped);
          registerCollider(kx,-1.2,1.1,0.9,0.08);

          const glassBox = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 0.75), glassMat);
          glassBox.position.set(kx, 1.32, -1.2);
          floor3RoomGroup.add(glassBox);

          const relic = new THREE.Mesh(
            new THREE.BoxGeometry(0.36, 0.14, 0.26),
            new THREE.MeshStandardMaterial({ color: kIdx % 2 === 0 ? 0xfacc15 : 0x38bdf8, metalness: 0.65 })
          );
          relic.position.set(kx, 1.06, -1.2);
          floor3RoomGroup.add(relic);
        });

        [-2.2, 2.2].forEach((bx) => {
          const bench = createWoodenBench(1.9);
          bench.position.set(bx, 0, 1.8);
          floor3RoomGroup.add(bench);
        });

        room301Teacher = createRealisticHuman({
          gender: theme.teacherGender,
          role: 'teacher',
          shirtColor: theme.teacherShirt
        });
        room301Teacher.position.set(0, 0, -4.4);
        room301Teacher.traverse((c) => {
          if (c.isMesh) c.userData.interactiveType = 'gift_teacher_301';
        });
        floor3RoomGroup.add(room301Teacher);

        // 2 Students admiring keepsake cases
        [
          { x: -4.8, z: -1.4, rotY: -Math.PI / 2, gender: 'female' },
          { x: 4.8, z: 0.6, rotY: Math.PI / 2, gender: 'male' }
        ].forEach((s, idx) => {
          const st = createRealisticHuman({ gender: s.gender, role: 'student' });
          st.position.set(s.x, 0, s.z);
          st.rotation.y = s.rotY;
          floor3RoomGroup.add(st);
          activeIdleCharacters.push({ mesh: st, phase: idx * 1.5 });
        });

        const photoSpots = [
          { x: -7.32, z: -3.4, rotY: Math.PI / 2, idx: 0 },
          { x: -7.32, z: 0, rotY: Math.PI / 2, idx: 1 },
          { x: -7.32, z: 3.4, rotY: Math.PI / 2, idx: 2 },
          { x: 7.32, z: -3.4, rotY: -Math.PI / 2, idx: 3 },
          { x: 7.32, z: 0, rotY: -Math.PI / 2, idx: 4 },
          { x: 7.32, z: 3.4, rotY: -Math.PI / 2, idx: 5 }
        ];
        photoSpots.forEach((sp) => {
          const item = ROOM301_PHOTOS[sp.idx];
          const tex = new THREE.TextureLoader().load(createArtCanvasDataURL(item));
          tex.encoding = THREE.sRGBEncoding;
          const frame = new THREE.Mesh(
            new THREE.BoxGeometry(2.3, 1.55, 0.1),
            new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.6, roughness: 0.3 })
          );
          frame.position.set(sp.x, 1.95, sp.z);
          frame.rotation.y = sp.rotY;
          const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(2.12, 1.38),
            new THREE.MeshBasicMaterial({ map: tex })
          );
          plane.position.z = 0.06;
          plane.userData = { interactiveType: 'zoom_photo_301', photoIndex: sp.idx };
          frame.add(plane);
          floor3RoomGroup.add(frame);
        });
      }

      roomHero = setProtagonistPose('walking', currentBuildingSide === 'teacher');
      roomHero.position.set(0, 0, 4.8);
      roomHero.rotation.y = Math.PI;
      floor3RoomGroup.add(roomHero);

      floor3RoomGroup.traverse((o) => {
        if (o.isMesh && o.userData && o.userData.interactiveType) interactiveList.push(o);
      });
    }

    function createCeremonialTributeTree(blossomColor = 0xf43f5e) {
      const tree = new THREE.Group();
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(1.15, 0.9, 0.65, 16),
        getProceduralPBRMaterial('stone', 0xf8fafc, 0.35)
      );
      pot.position.y = 0.325;
      tree.add(pot);

      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.3, 2.3, 12),
        getProceduralPBRMaterial('wood', 0x451a03, 0.7)
      );
      trunk.position.y = 1.6;
      tree.add(trunk);

      const canopyMat = new THREE.MeshStandardMaterial({
        color: blossomColor,
        emissive: blossomColor,
        emissiveIntensity: 0.18,
        roughness: 0.45
      });
      [[0, 2.9, 0, 1.2], [-0.85, 2.55, 0.35, 0.85], [0.85, 2.55, -0.35, 0.85], [0, 2.5, 0.8, 0.8]].forEach(([cx, cy, cz, r]) => {
        const crown = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 14), canopyMat);
        crown.position.set(cx, cy, cz);
        tree.add(crown);
      });

      const cardsHolder = new THREE.Group();
      tree.add(cardsHolder);
      tree.userData.cardsHolder = cardsHolder;
      return tree;
    }

    function refresh302TreeHangingCards() {
      if (!room302Trees.left || !room302Trees.right) return;
      const snap = window.TributeCloud ? window.TributeCloud.getSnapshot() : { cards: [] };
      ['left', 'right'].forEach((side) => {
        const holder = room302Trees[side].userData.cardsHolder;
        if (!holder) return;
        while (holder.children.length > 0) holder.remove(holder.children[0]);
        const list = (snap.cards || []).filter((c) => (c.treeSide || 'left') === side).slice(0, 10);
        list.forEach((c, idx) => {
          const angle = (idx / Math.max(1, list.length)) * Math.PI * 2;
          const cardMesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.28, 0.02),
            new THREE.MeshStandardMaterial({
              color: side === 'left' ? 0xfef08a : 0xfda4af,
              emissive: 0xf59e0b,
              emissiveIntensity: 0.25
            })
          );
          cardMesh.position.set(Math.cos(angle) * 1.15, 2.25 + (idx % 3) * 0.22, Math.sin(angle) * 1.15);
          cardMesh.rotation.y = angle;
          holder.add(cardMesh);
        });
      });
    }

    function buildRoom302() {
      while (floor3RoomGroup.children.length > 0) floor3RoomGroup.remove(floor3RoomGroup.children[0]);
      room302Trees = { left: null, right: null };
      pink302TableGroup = null;

      if (currentBuildingSide === 'female') {
        buildRoomShell(floor3RoomGroup, { width: 16, depth: 14, height: 4.1, exitType: 'exit_to_hallway3', floorType: 'wood', floorColor: 0x78350f });

        const banner = createSignBoard('PHÒNG TRI ÂN 302 • ĐẶT HOA, QUÀ & THƯ NHẬN CHỨNG NHẬN', '#831843', '#facc15', '#fef08a', 8.4, 0.68);
        banner.position.set(0, 3.45, -6.8);
        floor3RoomGroup.add(banner);

        const carpet = new THREE.Mesh(
          new THREE.BoxGeometry(3.4, 0.02, 9.6),
          new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.7 })
        );
        carpet.position.set(0, 0.01, -0.4);
        floor3RoomGroup.add(carpet);

        [[-6.6, -5.6], [6.6, -5.6], [-6.6, 5.4], [6.6, 5.4]].forEach(([px, pz]) => {
          const plant = createPottedIndoorPlant(1.05);
          plant.position.set(px, 0, pz);
          floor3RoomGroup.add(plant);
        });

        [-4.2, 4.2].forEach((bx) => {
          const bench = createWoodenBench(2.0);
          bench.position.set(bx, 0, 1.5);
          floor3RoomGroup.add(bench);
        });

        const shelfR = createBookshelfWithBooks(0xdb2777);
        shelfR.position.set(7.45, 0, -2.5);
        shelfR.rotation.y = -Math.PI / 2;
        floor3RoomGroup.add(shelfR);

        const table = new THREE.Mesh(
          new THREE.BoxGeometry(5.6, 0.16, 2.2),
          getProceduralPBRMaterial('wood', 0x451a03, 0.3, 0.15)
        );
        table.position.set(0, 0.85, -2.2);
        registerCollider(0,-2.2,5.6,2.2,0.2);
        table.userData = { interactiveType: 'open_pink302_modal' };
        floor3RoomGroup.add(table);

        const cloth = new THREE.Mesh(
          new THREE.BoxGeometry(5.7, 0.82, 2.3),
          new THREE.MeshStandardMaterial({ color: 0xbe185d, roughness: 0.65 })
        );
        cloth.position.set(0, 0.41, -2.2);
        cloth.userData = { interactiveType: 'open_pink302_modal' };
        floor3RoomGroup.add(cloth);

        pink302TableGroup = new THREE.Group();
        pink302TableGroup.position.set(0, 0.94, -2.2);
        floor3RoomGroup.add(pink302TableGroup);

        // Teacher & Students welcoming guests at the offering table
        const hostTeacher = createRealisticHuman({ gender: 'female', role: 'teacher', shirtColor: 0xbe185d });
        hostTeacher.position.set(0, 0, -3.9);
        floor3RoomGroup.add(hostTeacher);

        const helperSt1 = createRealisticHuman({ gender: 'female', role: 'student', shirtColor: 0xfce7f3, hasBouquet: true });
        helperSt1.position.set(-3.4, 0, -2.2);
        helperSt1.rotation.y = Math.PI / 2;
        floor3RoomGroup.add(helperSt1);

        const helperSt2 = createRealisticHuman({ gender: 'male', role: 'student', shirtColor: 0xffffff });
        helperSt2.position.set(3.4, 0, -2.2);
        helperSt2.rotation.y = -Math.PI / 2;
        floor3RoomGroup.add(helperSt2);

        activeIdleCharacters.push(
          { mesh: hostTeacher, phase: 0.3 },
          { mesh: helperSt1, phase: 1.2 },
          { mesh: helperSt2, phase: 2.1 }
        );
      } else {
        buildRoomShell(floor3RoomGroup, { width: 17, depth: 14, height: 4.2, exitType: 'exit_to_hallway3', floorType: 'wood', floorColor: 0x78350f });

        const banner = createSignBoard('VƯỜN HAI CÂY TRI ÂN 302 • TREO THIỆP LƯU CHUNG QUA LINK', '#0c4a6e', '#facc15', '#fef08a', 8.6, 0.68);
        banner.position.set(0, 3.55, -6.8);
        floor3RoomGroup.add(banner);

        [[-7.2, -5.6], [7.2, -5.6], [-7.2, 5.4], [7.2, 5.4]].forEach(([px, pz]) => {
          const plant = createPottedIndoorPlant(1.05);
          plant.position.set(px, 0, pz);
          floor3RoomGroup.add(plant);
        });

        // Wishing desks with calligraphy scrolls & wooden benches
        [-3.6, 3.6].forEach((wx) => {
          const wishDesk = new THREE.Mesh(
            new THREE.BoxGeometry(2.2, 0.74, 0.9),
            getProceduralPBRMaterial('wood', 0xb45309, 0.4)
          );
          wishDesk.position.set(wx, 0.37, 1.4);
          registerCollider(wx,1.4,2.2,0.9,0.15);
          wishDesk.userData = { interactiveType: 'open_tribute_tree', treeSide: wx < 0 ? 'left' : 'right' };
          floor3RoomGroup.add(wishDesk);

          const vase = createFlowerVase(wx < 0 ? 0xf43f5e : 0xfacc15);
          vase.position.set(wx + 0.65, 0.74, 1.4);
          floor3RoomGroup.add(vase);
        });

        const centerBench = createWoodenBench(2.4);
        centerBench.position.set(0, 0, -4.4);
        floor3RoomGroup.add(centerBench);

        const leftTree = createCeremonialTributeTree(0xf43f5e);
        leftTree.position.set(-3.6, 0, -2.0);
        leftTree.traverse((c) => {
          if (c.isMesh) {
            c.userData.interactiveType = 'open_tribute_tree';
            c.userData.treeSide = 'left';
          }
        });
        floor3RoomGroup.add(leftTree);

        const rightTree = createCeremonialTributeTree(0xfacc15);
        rightTree.position.set(3.6, 0, -2.0);
        rightTree.traverse((c) => {
          if (c.isMesh) {
            c.userData.interactiveType = 'open_tribute_tree';
            c.userData.treeSide = 'right';
          }
        });
        floor3RoomGroup.add(rightTree);

        // Students writing & hanging cards on the 2 Tribute Trees
        [
          { x: -1.8, z: -1.8, rotY: -Math.PI / 2, gender: 'female' },
          { x: 1.8, z: -1.8, rotY: Math.PI / 2, gender: 'male' },
          { x: -3.6, z: 2.3, rotY: Math.PI, gender: 'female' }
        ].forEach((s, idx) => {
          const st = createRealisticHuman({ gender: s.gender, role: 'student' });
          st.position.set(s.x, 0, s.z);
          st.rotation.y = s.rotY;
          floor3RoomGroup.add(st);
          activeIdleCharacters.push({ mesh: st, phase: idx * 1.1 });
        });

        room302Trees = { left: leftTree, right: rightTree };
        refresh302TreeHangingCards();
      }

      roomHero = setProtagonistPose('walking', true);
      roomHero.position.set(0, 0, 5.0);
      roomHero.rotation.y = Math.PI;
      floor3RoomGroup.add(roomHero);

      floor3RoomGroup.traverse((o) => {
        if (o.isMesh && o.userData && o.userData.interactiveType) interactiveList.push(o);
      });
    }

    // =========================================================================
    // 10. SCENE SWITCHING & WALK / DOOR / STAIR SEQUENCES
    // =========================================================================
    function applyInteriorCameraView(preservePose = false) {
      if (!roomHero || !camera || !controls) return;
      if (isFirstPersonPOV) {
        if (!preservePose) { fpYaw = roomHero.rotation.y; fpPitch = -0.04; }
        controls.enabled = false;
        roomHero.visible = false;
        camera.position.set(roomHero.position.x, roomHero.position.y + 1.57, roomHero.position.z);
        updatePOVCamera(1);
      } else {
        roomHero.visible = true;
        controls.enabled = true;
        controls.enablePan = false;
        controls.enableZoom = true;
        controls.minDistance = 2.2;
        controls.maxDistance = sceneMode.startsWith('hallway') ? 7 : 5.6;
        controls.minPolarAngle = 0.12;
        controls.maxPolarAngle = Math.PI * 0.47;
        if (!preservePose || cameraState.overviewScene !== sceneMode) {
          const hall = sceneMode.startsWith('hallway');
          cameraState.overview.position.set(hall ? roomHero.position.x - 2.65 : 0, hall ? 3.05 : 2.7, hall ? 3.0 : 4.25);
          cameraState.overview.target.set(hall ? roomHero.position.x : 0, 1.4, hall ? 0.25 : -1.8);
          cameraState.overviewScene = sceneMode;
        }
        camera.position.copy(cameraState.overview.position);
        controls.target.copy(cameraState.overview.target);
        controls.update();
      }
      updatePOVButtonUI();
    }

    function updatePOVCamera(alpha = 1) {
      if (!roomHero || !isFirstPersonPOV) return;
      const pos = new THREE.Vector3(roomHero.position.x, roomHero.position.y + 1.57, roomHero.position.z);
      camera.position.lerp(pos, alpha);
      const dist = 5;
      camera.lookAt(pos.x + Math.sin(fpYaw) * Math.cos(fpPitch) * dist,
                    pos.y + Math.sin(fpPitch) * dist,
                    pos.z + Math.cos(fpYaw) * Math.cos(fpPitch) * dist);
    }

    function switchSceneMode(mode) {
      // Dispose room 102's slide texture when leaving the board behind.
      if (sceneMode === 'room102' && mode !== 'room102' && room102SlideState) {
        room102SlideState.texture?.dispose();
        room102SlideState.pages.length = 0;
        room102SlideState = null;
        room102SlidePointer = null;
        room102SlideMesh = null;
      }
      // This is a virtual scene cut: the avatar never jumps through opaque geometry on screen.
      sceneMode = mode;
      if ('speechSynthesis' in window) { window.speechSynthesis.cancel(); speechPlaying = false; }
      interiorColliders = [];
      heroVelocity.set(0, 0, 0);
      transitionLock = false;
      classroomWalkAnim = exitRoomWalkAnim = stairClimbAnim = hallwayEntryAnim = campusDismountAnim = null;
      room101GiftAnim = room301GiftAnim = null;
      giftBloom = null;
      setSceneCurtain(false);
      interactiveList = [];
      activeIdleCharacters = [];
      hideSpeechCard();

      campusGroup.visible = mode === 'intro' || mode === 'campus';
      hallwayGroup.visible = mode === 'hallway';
      classroomGroup.visible = mode === 'room101' || mode === 'room102' || mode === 'room103';
      hallway2Group.visible = mode === 'hallway2';
      auditoriumGroup.visible = mode === 'room201' || mode === 'room202';
      hallway3Group.visible = mode === 'hallway3';
      floor3RoomGroup.visible = mode === 'room301' || mode === 'room302';

      configureLightingForMode(mode);

      const introOverlay = document.getElementById('intro-overlay');
      const mainUI = document.getElementById('main-ui');
      const backBtn = document.getElementById('btn-back');
      const campusPills = document.getElementById('campus-quick-pills');
      const theme = getActiveBuildingTheme();

      if (mode === 'intro') {
        controls.enabled = true;
        if (introOverlay) introOverlay.classList.remove('hidden');
        if (mainUI) mainUI.style.opacity = '0';
        buildCampusScene();
        camera.position.set(0, 9.5, 36);
        controls.target.set(0, 2.5, 16);
        return;
      }

      if (introOverlay) introOverlay.classList.add('hidden');
      if (mainUI) mainUI.style.opacity = '1';

      if (mode === 'campus') {
        isFirstPersonPOV = false;
        updatePOVButtonUI();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        controls.enabled = true;
        controls.maxDistance = 44;
        controls.minDistance = 4;
        controls.enablePan = true;
        if (backBtn) backBtn.classList.add('hidden');
        if (campusPills) campusPills.classList.remove('hidden');
        setClassroomControls([]);
        updateHeaderStatus('Khuôn Viên Tri Ân 20/11');
        if (campusGroup.children.length === 0) buildCampusScene();
        // Scooter -> campus: detach and animate exactly the same student.
        // The motorcycle stays parked and visibly empty after dismount.
        const arrivingFromScooter = campusHero?.parent === campusScooterGroup;
        campusHero = setProtagonistPose('walking', true);
        if (campusHero.parent !== campusGroup) {
          campusGroup.add(campusHero);
          const scooterZ = campusScooterGroup?.position.z ?? 18;
          const initialZ = arrivingFromScooter ? scooterZ + 0.06 : 17.6;
          campusHero.position.set(arrivingFromScooter ? 0.03 : 0.85, 0.14, initialZ);
          campusHero.rotation.y = Math.PI;
          if (arrivingFromScooter) {
            campusDismountAnim = { elapsed: 0, duration: 1.05,
              startX: 0.03, startZ: initialZ,
              endX: 0.85, endZ: scooterZ - 0.40 };
          }
        }
        campusGroup.traverse((o) => {
          if (o.isMesh && o.userData && o.userData.interactiveType) interactiveList.push(o);
        });
        camera.position.set(0, 12.5, 33);
        controls.target.set(0, 2.5, 4);
        return;
      }

      if (backBtn) backBtn.classList.remove('hidden');
      if (campusPills) campusPills.classList.add('hidden');

      if (mode === 'hallway') {
        buildHallway1();
        updateHeaderStatus(`${theme.shortName} • Hành Lang Tầng 1`);
        setClassroomControls([
          { label: currentBuildingSide === 'female' ? '🎈 Phòng 101 (Trang Trí)' : '💐 Phòng 101 (Tặng Hoa)', onClick: () => startEnterClassroomWalk('room101', -9.2) },
          { label: '📽️ Phòng 102', onClick: () => startEnterClassroomWalk('room102', -4.6) },
          { label: '🖼️ Phòng 103', onClick: () => startEnterClassroomWalk('room103', 6.8) },
          { label: '🪜 Lên Tầng 2', onClick: () => startStairClimb('hallway2', true) },
          { label: '🌳 Ra Sân Trường', onClick: () => startExitBuildingToCampus() }
        ]);
      } else if (mode === 'room101') {
        buildRoom101();
        updateHeaderStatus(`${theme.shortName} • Phòng 101`);
        if (currentBuildingSide === 'female') {
          setClassroomControls([
            { label: '💬 Trò Chuyện Các Bạn', onClick: () => triggerTalkDecorStudent() },
            { label: '🎨 Đổi Tông Trang Trí', onClick: () => { pinkDecorThemeIdx++; applyPinkClassroomDecorTheme(classroomGroup, pinkDecorThemeIdx); playChime(660, 0.16); } },
            { label: '✍️ Viết Lên Bảng Xanh', onClick: () => document.getElementById('chalkboard-modal').classList.remove('hidden') },
            { label: '🚪 Ra Hành Lang', onClick: () => startExitRoomWalk('hallway', -9.2) }
          ]);
        } else {
          setClassroomControls([
            { label: '💐 Tặng Hoa Thầy/Cô', onClick: () => triggerRoom101Gift() },
            { label: '✍️ Viết Lên Bảng Xanh', onClick: () => document.getElementById('chalkboard-modal').classList.remove('hidden') },
            { label: '🚪 Ra Hành Lang', onClick: () => startExitRoomWalk('hallway', -9.2) }
          ]);
        }
      } else if (mode === 'room102') {
        buildRoom102();
        updateHeaderStatus(`${theme.shortName} • Phòng 102`);
        const list = [
          { label: '📰 Đọc Báo Tường', onClick: () => document.getElementById('magazine-modal').classList.remove('hidden') },
          { label: '🚪 Ra Hành Lang', onClick: () => startExitRoomWalk('hallway', -4.6) }
        ];
        if (currentBuildingSide === 'female') {
          list.unshift({ label: '🎨 Đổi Màu Bóng Bay', onClick: () => { pinkDecorThemeIdx++; applyPinkClassroomDecorTheme(classroomGroup, pinkDecorThemeIdx); playChime(640, 0.15); } });
        }
        setClassroomControls(list);
      } else if (mode === 'room103') {
        buildRoom103();
        updateHeaderStatus(`${theme.shortName} • Phòng 103`);
        setClassroomControls([
          { label: '🖼️ Xem Tranh Triển Lãm', onClick: () => openArtworkViewer(0) },
          { label: '📚 Đọc 5 Tập San 20/11', onClick: () => openAnthologyModal(0) },
          { label: '🚪 Ra Hành Lang', onClick: () => startExitRoomWalk('hallway', 6.8) }
        ]);
      } else if (mode === 'hallway2') {
        buildHallway2();
        updateHeaderStatus(`${theme.shortName} • Hành Lang Tầng 2`);
        setClassroomControls([
          { label: currentBuildingSide === 'female' ? '🏛️ Phòng 201 (Họp Hội Đồng)' : '🎭 Hội Trường 201 (Văn Nghệ)', onClick: () => startEnterClassroomWalk('room201', -6.8) },
          { label: currentBuildingSide === 'female' ? '🏅 Phòng 202 (Vinh Danh)' : '📺 Trường Quay 202', onClick: () => startEnterClassroomWalk('room202', 6.8) },
          { label: '🪜 Lên Tầng 3', onClick: () => startStairClimb('hallway3', true) },
          { label: '⬇️ Xuống Tầng 1', onClick: () => startStairClimb('hallway', false) }
        ]);
      } else if (mode === 'room201') {
        buildRoom201();
        updateHeaderStatus(`${theme.shortName} • Phòng 201`);
        if (currentBuildingSide === 'female') {
          setClassroomControls([
            { label: '🤝 Kính Chào Hội Đồng Giáo Viên', onClick: () => showSpeechCard('Hội Đồng Sư Phạm', 'Thay mặt Ban Giám Hiệu và toàn thể Thầy Cô (Thầy A, Cô B, Thầy C, Cô D), cảm ơn các em học sinh đã đến chung vui ngày Nhà giáo Việt Nam 20/11!') },
            { label: '🚪 Ra Hành Lang', onClick: () => startExitRoomWalk('hallway2', -6.8) }
          ]);
        } else {
          setClassroomControls([
            { label: '👏 Cổ Vũ Văn Nghệ', onClick: () => { playChime(740, 0.22); showSpeechCard('Hội Trường 201', 'Tiết mục hát múa “Người Thầy Năm Xưa” nhận được tràng pháo tay vang dội từ Quý Thầy Cô và toàn thể học sinh!'); } },
            { label: '🚪 Ra Hành Lang', onClick: () => startExitRoomWalk('hallway2', -6.8) }
          ]);
        }
      } else if (mode === 'room202') {
        buildRoom202();
        updateHeaderStatus(`${theme.shortName} • Phòng 202`);
        if (currentBuildingSide === 'female') {
          setClassroomControls([
            { label: '🏅 Xem Bảng Vàng Thầy A & Cô B', onClick: () => showSpeechCard('Bảng Vàng Vinh Danh 20/11', 'Vinh danh Thầy A (Nhà Giáo Ưu Tú), Cô B (Chiến Sĩ Thi Đua Toàn Quốc), Thầy C & Cô D vì những đóng góp xuất sắc cho sự nghiệp trồng người!') },
            { label: '🚪 Ra Hành Lang', onClick: () => startExitRoomWalk('hallway2', 6.8) }
          ]);
        } else {
          setClassroomControls([
            { label: '🎙️ Phỏng Vấn Tri Ân', onClick: () => showSpeechCard('Phóng Sự 20/11', 'MC: “Thưa Thầy, điều gì khiến Thầy hạnh phúc nhất trong nghề giáo?” — Thầy: “Đó là khi thấy học trò trưởng thành và sống tử tế!”') },
            { label: '🚪 Ra Hành Lang', onClick: () => startExitRoomWalk('hallway2', 6.8) }
          ]);
        }
      } else if (mode === 'hallway3') {
        buildHallway3();
        updateHeaderStatus(`${theme.shortName} • Hành Lang Tầng 3`);
        setClassroomControls([
          { label: currentBuildingSide === 'female' ? '🖼️ Phòng 301 (Treo Ảnh & Chúc)' : '🎁 Phòng 301 (Kỷ Vật)', onClick: () => startEnterClassroomWalk('room301', -6.8) },
          { label: currentBuildingSide === 'female' ? '🏅 Phòng 302 (Tri Ân & Chứng Nhận)' : '🌳 Phòng 302 (2 Cây Tri Ân)', onClick: () => startEnterClassroomWalk('room302', 6.8) },
          { label: '⬇️ Xuống Tầng 2', onClick: () => startStairClimb('hallway2', false) }
        ]);
      } else if (mode === 'room301') {
        buildRoom301();
        updateHeaderStatus(`${theme.shortName} • Phòng 301`);
        if (currentBuildingSide === 'female') {
          setClassroomControls([
            { label: '📌 Tải Ảnh / Treo Lời Chúc', onClick: () => openPink301Modal(0) },
            { label: '🚪 Ra Hành Lang', onClick: () => startExitRoomWalk('hallway3', -6.8) }
          ]);
        } else {
          setClassroomControls([
            { label: '💐 Tặng Hoa Thầy/Cô', onClick: () => triggerRoom301Gift() },
            { label: '🔍 Phóng To Ảnh Kỷ Niệm', onClick: () => openPhotoZoomModal(0) },
            { label: '🚪 Ra Hành Lang', onClick: () => startExitRoomWalk('hallway3', -6.8) }
          ]);
        }
      } else if (mode === 'room302') {
        buildRoom302();
        updateHeaderStatus(`${theme.shortName} • Phòng 302`);
        if (currentBuildingSide === 'female') {
          setClassroomControls([
            { label: '🎁 Đặt Hoa / Quà / Thư (5k)', onClick: () => document.getElementById('pink-302-modal').classList.remove('hidden') },
            { label: '🚪 Ra Hành Lang', onClick: () => startExitRoomWalk('hallway3', 6.8) }
          ]);
        } else {
          setClassroomControls([
            { label: '💌 Viết & Treo Thiệp Lên Cây', onClick: () => openTributeTreeModal('left') },
            { label: '🚪 Ra Hành Lang', onClick: () => startExitRoomWalk('hallway3', 6.8) }
          ]);
        }
      }

      applyInteriorCameraView();
    }

    function startEnterBuildingSequence(side) {
      if (activeTransition()) return;
      currentBuildingSide = side;
      lastExitedDoorX = 0;
      if (sceneMode !== 'campus') switchSceneMode('campus');
      const targetX = side === 'female' ? 8.6 : -8.6;
      const targetZ = -2.0;
      // Walk from the current dismount position. Hiding scooterRiderMesh
      // would hide campusHero as well: they now refer to the SAME mesh.
      const startX = campusHero?.position.x ?? 0.85;
      const startZ = campusHero?.position.z ?? 17.6;
      campusEnterBuildingAnim = {
        progress: 0,
        startX,
        startZ,
        targetX,
        targetZ,
        side
      };
      playChime(580, 0.16);
    }

    function startExitBuildingToCampus() {
      const side = currentBuildingSide;
      switchSceneMode('campus');
      const outX = side === 'female' ? 8.4 : -8.4;
      if (campusHero) {
        campusHero.position.set(outX, 0.14, -2.0);
        campusHero.rotation.y = 0;
      }
      camera.position.set(outX * 0.5, 4.2, 8.5);
      controls.target.set(outX, 1.8, -2.0);
      playChime(460, 0.15);
    }

    function startEnterClassroomWalk(targetRoomMode, doorX) {
      if (activeTransition()) return;
      if (!roomHero) {
        switchSceneMode(targetRoomMode);
        return;
      }
      const doorsMap =
        sceneMode === 'hallway'
          ? hallwayGroup.userData.doors
          : sceneMode === 'hallway2'
            ? hallway2Group.userData.doors
            : hallway3Group.userData.doors;
      const doorKey = targetRoomMode.replace('room', 'enter_');
      classroomWalkAnim = {
        progress: 0,
        startX: roomHero.position.x,
        startZ: roomHero.position.z,
        doorX,
        pathMidZ: Math.max(-0.75, roomHero.position.z - 0.25),
        targetRoomMode,
        pivots: doorsMap ? doorsMap[doorKey] : null
      };
      playChime(600, 0.14);
    }

    function startExitRoomWalk(targetHallwayMode, exitDoorX) {
      if (activeTransition()) return;
      lastExitedDoorX = exitDoorX;
      const exitPivots =
        classroomGroup.visible
          ? classroomGroup.userData.exitDoorPivots
          : auditoriumGroup.visible
            ? auditoriumGroup.userData.exitDoorPivots
            : floor3RoomGroup.userData.exitDoorPivots;
      if (!roomHero) {
        switchSceneMode(targetHallwayMode);
        return;
      }
      exitRoomWalkAnim = {
        progress: 0,
        startX: roomHero.position.x,
        startZ: roomHero.position.z,
        targetHallwayMode,
        pivots: exitPivots
      };
      playChime(500, 0.14);
    }

    function startStairClimb(targetHallwayMode, goingUp) {
      if (activeTransition() || !roomHero) return;
      lastExitedDoorX = 0;
      // Adjacent floors share the same shafts, not a single merged staircase.
      const shaftX = goingUp
        ? HALL_STAIR.up[sceneMode]
        : HALL_STAIR.down[sceneMode];
      if (!Number.isFinite(shaftX)) return;
      const rise=HALL_STAIR.landingY/2;
      const zEntrance=0.94, zNear=0.80, zFar=-2.10, zLanding=-2.53;
      const entranceX=shaftX+(goingUp?1.04:-1.04);
      const exitX=shaftX+(goingUp?-1.04:1.04);
      const start=[roomHero.position.x,0,roomHero.position.z];
      const foyer=[0,0,2.20];
      const lateral=[entranceX,0,2.18];
      const entry=[entranceX,0,zEntrance];
      // The first two waypoints keep the avatar on the corridor floor.
      const segments=[
        {name:'foyer',end:foyer,seconds:Math.max(0.50,Math.hypot(start[0]-foyer[0],start[2]-foyer[2])/1.75)},
        {name:'approach-side',end:lateral,seconds:Math.max(0.65,Math.abs(entranceX)/1.55)},
        {name:'approach-tread',end:entry,seconds:0.9}
      ];
      if(goingUp) {
        segments.push(
          {name:'flight-1',end:[shaftX+1.04,rise,zFar],seconds:3.75},
          {name:'landing-in',end:[shaftX+0.60,rise,zLanding],seconds:0.75},
          {name:'landing-turn',end:[shaftX-1.04,rise,zLanding],seconds:1.6},
          {name:'flight-2',end:[shaftX-1.04,rise*2,zNear],seconds:3.75},
          {name:'exit',end:[exitX,rise*2,1.20],seconds:0.75}
        );
      } else {
        segments.push(
          {name:'flight-2',end:[shaftX-1.04,-rise,zFar],seconds:3.75},
          {name:'landing-in',end:[shaftX-0.60,-rise,zLanding],seconds:0.75},
          {name:'landing-turn',end:[shaftX+1.04,-rise,zLanding],seconds:1.6},
          {name:'flight-1',end:[shaftX+1.04,-rise*2,zNear],seconds:3.75},
          {name:'exit',end:[exitX,-rise*2,1.20],seconds:0.75}
        );
      }
      let last=start;
      const steps=segments.map(item=>{const result={...item,start:last};last=item.end;return result;});
      stairClimbAnim={stage:0,stageTime:0,progress:0,steps,targetHallwayMode,goingUp,shaftX,exitX};
      resetHeroMotion();
      if(controls && !isFirstPersonPOV) controls.enabled=false;
      playChime(goingUp?610:455,0.11);
    }

    function startGiftCeremony(whichRoom) {
      if (activeTransition() || sceneMode !== whichRoom) return;
      const teacher = whichRoom === 'room101' ? room101Teacher : room301Teacher;
      if (!teacher || !roomHero) return;
      const studentFlowers = roomHero.userData.bouquetMesh;
      const teacherFlowers = teacher.userData.bouquetMesh;
      if (studentFlowers) studentFlowers.visible = true;
      if (teacherFlowers) teacherFlowers.visible = false;

      const receiver = currentBuildingSide === 'female' ? 'cô' : 'thầy';
      const targetZ = whichRoom === 'room101' ? -3.22 : -3.25;
      const walkDistance = Math.hypot(roomHero.position.x, roomHero.position.z - targetZ);
      const gift = {
        stage: 'walk', stageTime: 0, progress: 0,
        delivered: false, studentSpoken: false, studentDone: false,
        teacherSpoken: false, teacherDone: false,
        startX: roomHero.position.x, startZ: roomHero.position.z,
        targetX: 0, targetZ,
        walkDuration: Math.max(2.5, Math.min(7, walkDistance / 1.35)),
        studentLine: `Thưa ${receiver}, em xin kính tặng ${receiver} bó hoa nhân ngày Nhà giáo Việt Nam 20 tháng 11. Em cảm ơn ${receiver} ạ!`,
        teacherLine: currentBuildingSide === 'female'
          ? 'Cô cảm ơn em. Cô chúc em luôn tự tin và học tập thật tốt nhé!'
          : 'Thầy cảm ơn em. Chúc em luôn chăm ngoan, học giỏi và vững bước trên hành trình phía trước!',
        teacher, whichRoom
      };
      if (whichRoom === 'room101') room101GiftAnim = gift;
      else room301GiftAnim = gift;
      resetHeroMotion();
      // No greeting or voiceover during the approach.
      showSpeechCard('Hành trình tặng hoa', `Học sinh đang mang bó hoa đến chỗ ${receiver} giáo…`);
      // Unlock the existing audio context while the original click gesture is active.
      if (sharedAudioContext && sharedAudioContext.state === 'suspended') sharedAudioContext.resume();
      playChime(520, 0.10);
    }

    function triggerRoom101Gift() { startGiftCeremony('room101'); }
    function triggerRoom301Gift() { startGiftCeremony('room301'); }

    function updateGiftCeremony(g, dt, elapsed) {
      if (!g || !roomHero || !g.teacher) return;
      g.stageTime += dt;
      const pupil = roomHero.userData;
      const teacher = g.teacher.userData;

      if (g.stage === 'walk') {
        const t = smooth01(g.stageTime / g.walkDuration);
        g.progress = t * 0.48;
        roomHero.position.x = THREE.MathUtils.lerp(g.startX, g.targetX, t);
        roomHero.position.z = THREE.MathUtils.lerp(g.startZ, g.targetZ, t);
        roomHero.rotation.y = THREE.MathUtils.lerp(roomHero.rotation.y, Math.PI, Math.min(1, dt * 7));
        animateHumanWalk(roomHero, elapsed, 8, dt);
        // The bouquet stays in the student's hand, held in front of the body.
        if (pupil.rightArm) pupil.rightArm.rotation.x = -0.38;
        if (pupil.bouquetMesh) pupil.bouquetMesh.visible = true;
        if (g.stageTime >= g.walkDuration) {
          roomHero.position.set(g.targetX, roomHero.position.y, g.targetZ);
          resetHeroMotion();
          g.stage = 'offer';
          g.stageTime = 0;
          g.progress = 0.48;
        }
        return;
      }

      if (g.stage === 'offer') {
        animateHumanWalk(roomHero, elapsed, 0, dt);
        const reach = smooth01(g.stageTime / 0.95);
        g.progress = 0.48 + 0.25 * reach;
        if (pupil.rightArm) pupil.rightArm.rotation.x = -0.38 - reach * 0.70;
        if (teacher.rightArm) teacher.rightArm.rotation.x = -0.12 - reach * 0.92;
        if (pupil.leftArm) pupil.leftArm.rotation.x = -reach * 0.12;
        if (!g.studentSpoken && g.stageTime >= 0.68) {
          g.studentSpoken = true;
          showSpeechCard('Học sinh • Lời tri ân', g.studentLine);
          speakVietnamese(g.studentLine, () => { g.studentDone = true; });
        }
        // Keep the bouquet in the pupil's hand while the pupil is speaking.
        if (g.stageTime >= 1.65 && (g.studentDone || g.stageTime >= 7.5)) {
          g.delivered = true;
          if (pupil.bouquetMesh) pupil.bouquetMesh.visible = false;
          if (teacher.bouquetMesh) teacher.bouquetMesh.visible = true;
          giftBloom = { time: 0, origin: g.teacher.position.clone() };
          playChime(820, 0.18);
          g.stage = 'receive';
          g.stageTime = 0;
          g.progress = 0.74;
        }
        return;
      }

      if (g.stage === 'receive') {
        const settle = smooth01(g.stageTime / 1.1);
        g.progress = 0.74 + settle * 0.12;
        if (pupil.rightArm) pupil.rightArm.rotation.x = -1.08 + settle * 0.82;
        if (teacher.rightArm) teacher.rightArm.rotation.x = -1.04 + settle * 0.70;
        if (!g.teacherSpoken && g.stageTime >= 0.55) {
          g.teacherSpoken = true;
          showSpeechCard('Giáo viên • Lời đáp', g.teacherLine);
          speakVietnamese(g.teacherLine, () => { g.teacherDone = true; });
        }
        if (g.stageTime >= 1.55 && (g.teacherDone || g.stageTime >= 8.0)) {
          g.stage = 'bow';
          g.stageTime = 0;
        }
        return;
      }

      if (g.stage === 'bow') {
        const t = Math.min(1, g.stageTime / 1.4);
        g.progress = 0.86 + t * 0.14;
        if (pupil.headGroup) pupil.headGroup.rotation.x = Math.sin(Math.PI * t) * 0.24;
        if (pupil.rightArm) pupil.rightArm.rotation.x = -0.26 * (1 - t);
        if (teacher.rightArm) teacher.rightArm.rotation.x = -0.34;
        if (t >= 1) {
          if (pupil.headGroup) pupil.headGroup.rotation.x = 0;
          if (pupil.leftArm) pupil.leftArm.rotation.x = 0;
          if (pupil.rightArm) pupil.rightArm.rotation.x = 0;
          if (g.whichRoom === 'room101') room101GiftAnim = null;
          else room301GiftAnim = null;
        }
      }
    }

    function triggerTalkDecorStudent() {
      playChime(680, 0.16);
      showSpeechCard(
        'Nhóm Học Sinh Trang Trí Lớp',
        'Chào bạn! Tụi mình đang treo bóng bay, dây cờ và kết hoa chào mừng 20/11. Bạn nhấn “Đổi Tông Trang Trí” hoặc viết lời chúc lên bảng xanh cùng tụi mình nhé!'
      );
    }

    function updateRoom101ChalkboardWish(wishText) {
      if (!room101BoardMesh) return;
      const tex = makeCanvasTexture(`board_101_custom_${Date.now()}`, 1024, 384, (ctx, w, h) => {
        ctx.fillStyle = '#064e3b';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 14;
        ctx.strokeRect(8, 8, w - 16, h - 16);
        ctx.fillStyle = '#fef9c3';
        ctx.font = '800 36px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('LỜI CHÚC TRI ÂN 20/11 TRÊN BẢNG XANH', w / 2, 95);
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 30px Inter, sans-serif';
        const line1 = wishText.slice(0, 44);
        const line2 = wishText.slice(44, 92);
        ctx.fillText(`“${line1}${line2 ? '' : '”'}`, w / 2, 185);
        if (line2) {
          ctx.fillText(`${line2}”`, w / 2, 235);
        }
        ctx.fillStyle = '#6ee7b7';
        ctx.font = '600 22px Inter, sans-serif';
        ctx.fillText('— Tập Thể Học Sinh Kính Tặng Quý Thầy Cô —', w / 2, 315);
      });
      room101BoardMesh.material.map = tex;
      room101BoardMesh.material.needsUpdate = true;
    }

    // In-world room 102 slide deck: render only into a reusable CanvasTexture.
    function slideWrapLines(ctx, text, maxWidth, maxLines) {
      const words = String(text || '').trim().split(/\s+/);
      const lines = [];
      let line = '';
      for (const word of words) {
        const candidate = line ? line + ' ' + word : word;
        if (line && ctx.measureText(candidate).width > maxWidth) {
          lines.push(line); line = word;
          if (lines.length >= maxLines-1) break;
        } else line = candidate;
      }
      if (line) lines.push(line);
      return lines;
    }

    function createRoom102PageCanvas(index) {
      const page=SLIDE_PAGES[index], canvas=document.createElement('canvas');
      const W=1280,H=576;
      canvas.width=W;canvas.height=H;
      const ctx=canvas.getContext('2d');
      const palette=[
        ['#0b1930','#173d64','#fbbf24'],
        ['#071f2a','#115e68','#67e8f9'],
        ['#21152e','#623a77','#f9a8d4'],
        ['#0b2522','#145745','#86efac']
      ][index%4];
      const grad=ctx.createLinearGradient(0,0,W,H);
      grad.addColorStop(0,palette[0]);grad.addColorStop(1,palette[1]);
      ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);
      ctx.strokeStyle='rgba(255,255,255,0.06)';
      ctx.lineWidth=2;
      for(let k=0;k<7;k++){ctx.beginPath();ctx.arc(W-120,k*82-50,130+k*20,0,Math.PI*2);ctx.stroke();}
      ctx.fillStyle=palette[2];
      ctx.fillRect(0,0,12,H);ctx.fillRect(92,99,100,5);
      ctx.textAlign='left';ctx.font='700 22px Inter,Arial,sans-serif';
      ctx.fillText('BÀI GIẢNG  •  TRI ÂN 20/11',94,70);
      ctx.fillStyle='#fff';ctx.font='800 39px Inter,Arial,sans-serif';
      const titles=slideWrapLines(ctx,page.title,W-210,3);
      titles.forEach((line,i)=>ctx.fillText(line,94,161+i*51));
      const y=205+Math.max(0,titles.length-1)*50;
      ctx.fillStyle='rgba(241,245,249,0.98)';
      ctx.font='500 28px Inter,Arial,sans-serif';
      slideWrapLines(ctx,page.body,W-225,4).forEach((line,i)=>ctx.fillText(line,94,y+i*41));
      ctx.strokeStyle='rgba(255,255,255,0.18)';
      ctx.beginPath();ctx.moveTo(95,480);ctx.lineTo(W-95,480);ctx.stroke();
      ctx.fillStyle='rgba(226,232,240,0.85)';ctx.font='600 19px Inter,Arial,sans-serif';
      ctx.fillText('VUỐT TRÁI / PHẢI HOẶC CHẠM ĐỂ ĐỔI SLIDE',95,520);
      ctx.textAlign='right';ctx.font='800 22px Inter,Arial,sans-serif';
      ctx.fillStyle='#fff';
      ctx.fillText(String(index+1).padStart(2,'0')+' / '+String(SLIDE_PAGES.length).padStart(2,'0'),W-95,520);
      ctx.textAlign='center';ctx.font='48px Arial,sans-serif';
      ctx.fillStyle='rgba(255,255,255,0.60)';
      ctx.fillText('‹',42,305);ctx.fillText('›',W-42,305);
      return canvas;
    }

    function initRoom102Slides() {
      if (room102SlideState?.texture) room102SlideState.texture.dispose();
      if (!room102SlideMesh) return;
      const canvas=document.createElement('canvas');
      canvas.width=1280;canvas.height=576;
      const texture=new THREE.CanvasTexture(canvas);
      texture.encoding=THREE.sRGBEncoding;
      texture.minFilter=THREE.LinearFilter;
      texture.magFilter=THREE.LinearFilter;
      room102SlideMesh.material.map=texture;
      room102SlideMesh.material.needsUpdate=true;
      currentSlideIdx=0;
      room102SlideState={
        canvas,ctx:canvas.getContext('2d'),texture,
        pages:SLIDE_PAGES.map((_,i)=>createRoom102PageCanvas(i)),
        motion:null
      };
      paintRoom102Slide(0);
    }

    function paintRoom102Slide(offset) {
      const v=room102SlideState;
      if (!v) return;
      const W=v.canvas.width,H=v.canvas.height;
      const t=THREE.MathUtils.clamp(offset,-1,1);
      v.ctx.clearRect(0,0,W,H);
      v.ctx.fillStyle='#0b1930';v.ctx.fillRect(0,0,W,H);
      v.ctx.drawImage(v.pages[currentSlideIdx],Math.round(t*W),0,W,H);
      if(Math.abs(t)>0.001){
        const other=(currentSlideIdx+(t<0?1:-1)+SLIDE_PAGES.length)%SLIDE_PAGES.length;
        v.ctx.drawImage(v.pages[other],Math.round((t+(t<0?1:-1))*W),0,W,H);
      }
      v.texture.needsUpdate=true;
    }

    function changeRoom102Slide(direction, from=0) {
      if(sceneMode!=='room102'||!room102SlideState||room102SlideState.motion)return;
      const d=Math.sign(direction);
      room102SlideState.motion={direction:d,from,to:d===0?0:-d,elapsed:0,duration:d?0.32:0.20};
    }

    function updateRoom102SlideAnimation(dt) {
      const v=room102SlideState;
      if(sceneMode!=='room102'||!v||!v.motion||room102SlidePointer) return;
      const m=v.motion;
      m.elapsed=Math.min(m.duration,m.elapsed+dt);
      const t=smooth01(m.elapsed/m.duration);
      paintRoom102Slide(THREE.MathUtils.lerp(m.from,m.to,t));
      if(t>=1){
        if(m.direction) currentSlideIdx=(currentSlideIdx+m.direction+SLIDE_PAGES.length)%SLIDE_PAGES.length;
        v.motion=null;
        paintRoom102Slide(0);
      }
    }

    function openArtworkViewer(idx) {
      const art = GALLERY_ARTWORKS[idx % GALLERY_ARTWORKS.length];
      document.getElementById('art-modal-title').textContent = art.title;
      document.getElementById('art-modal-desc').textContent = art.desc;
      document.getElementById('art-modal-img').src = createArtCanvasDataURL(art);
      document.getElementById('artwork-modal').classList.remove('hidden');
    }

    function renderAnthologySpread() {
      const book=ANTHOLOGY_BOOKS[currentAnthologyBookIdx];
      const page=book.pages[currentAnthologyPageIdx];
      const words=String(page.body).split(/\s+/).filter(Boolean);
      const mid=Math.ceil(words.length/2);
      document.getElementById('anthology-chapter').textContent=book.name;
      document.getElementById('anthology-title').textContent=page.title;
      document.getElementById('anthology-body').textContent=words.slice(0,mid).join(' ');
      document.getElementById('anthology-right-body').textContent=words.slice(mid).join(' ');
      document.getElementById('anthology-author').textContent='— '+page.author;
      document.getElementById('anthology-counter').textContent=
        (currentAnthologyPageIdx+1)+' / '+book.pages.length;
      document.getElementById('anthology-left-number').textContent=
        String(currentAnthologyPageIdx*2+1).padStart(2,'0');
      document.getElementById('anthology-right-number').textContent=
        String(currentAnthologyPageIdx*2+2).padStart(2,'0');
      document.querySelectorAll('.anthology-tab').forEach((tab,i)=>{
        tab.classList.toggle('anthology-tab-active',i===currentAnthologyBookIdx);
        tab.setAttribute('aria-current',i===currentAnthologyBookIdx?'page':'false');
      });
    }

    function openAnthologyModal(bookIdx=0,pageIdx=0) {
      const index=(bookIdx+ANTHOLOGY_BOOKS.length)%ANTHOLOGY_BOOKS.length;
      const book=ANTHOLOGY_BOOKS[index];
      const target=(pageIdx%book.pages.length+book.pages.length)%book.pages.length;
      const modal=document.getElementById('anthology-modal');
      const shell=document.getElementById('anthology-book-shell');
      if(!modal||!shell||anthologyTurning)return;
      const alreadyVisible=!modal.classList.contains('hidden');
      const sameBook=index===currentAnthologyBookIdx;
      if(alreadyVisible&&sameBook&&currentAnthologyPageIdx!==target) {
        anthologyTurning=true;
        const direction=pageIdx>currentAnthologyPageIdx?1:-1;
        shell.classList.remove('turning-next','turning-prev');
        // Force animation reset when immediately turning multiple pages.
        void shell.offsetWidth;
        shell.classList.add(direction>0?'turning-next':'turning-prev');
        beginRoom103PageTurn(direction);
        setTimeout(()=>{
          currentAnthologyPageIdx=target;
          renderAnthologySpread();
        },320);
        setTimeout(()=>{
          shell.classList.remove('turning-next','turning-prev');
          anthologyTurning=false;
        },680);
      }else{
        currentAnthologyBookIdx=index;
        currentAnthologyPageIdx=target;
        renderAnthologySpread();
        modal.classList.remove('hidden');
        shell.classList.remove('turning-next','turning-prev');
        beginRoom103PageTurn(1);
      }
    }

    let currentPhotoZoom = 1;
    let currentPhotoIdx301 = 0;
    function openPhotoZoomModal(idx) {
      currentPhotoIdx301 = idx % ROOM301_PHOTOS.length;
      currentPhotoZoom = 1;
      const item = ROOM301_PHOTOS[currentPhotoIdx301];
      document.getElementById('photo-zoom-title').textContent = item.title;
      document.getElementById('photo-zoom-desc').textContent = item.desc;
      const img = document.getElementById('photo-zoom-img');
      img.src = createArtCanvasDataURL(item);
      img.style.transform = 'scale(1)';
      document.getElementById('photo-zoom-badge').textContent = '100%';
      document.getElementById('photo-zoom-modal').classList.remove('hidden');
    }

    function renderTributeCardsFeed() {
      const feed = document.getElementById('tribute-cards-feed');
      const countEl = document.getElementById('tribute-total-count');
      const quotaEl = document.getElementById('tribute-quota-badge');
      if (!feed) return;
      const snap = window.TributeCloud ? window.TributeCloud.getSnapshot() : { cards: [], freeUsed: 0, extraCredits: 0 };
      const cards = snap.cards || [];
      if (countEl) countEl.textContent = String(cards.length);
      if (quotaEl) {
        const remFree = Math.max(0, 2 - (snap.freeUsed || 0));
        quotaEl.textContent = `🎁 Miễn phí: ${remFree}/2 thiệp • Lượt mua thêm: ${snap.extraCredits || 0}`;
      }
      feed.innerHTML = '';
      cards.forEach((c) => {
        const div = document.createElement('div');
        div.className = 'bg-slate-900/85 rounded-xl p-2.5 border border-white/10 text-xs';
        const header=document.createElement('div');
        header.className='font-bold text-amber-300';
        header.textContent=`${c.treeSide==='right'?'🌼':'🌸'} ${c.teacherName||'Quý Thầy Cô'}`;
        const msg=document.createElement('div');
        msg.className='text-slate-200 mt-1';
        msg.textContent=c.message||'';
        const sender=document.createElement('div');
        sender.className='text-right text-[11px] text-rose-300 mt-1';
        sender.textContent=`— ${c.senderName||'Học trò'}`;
        div.append(header,msg,sender);
        feed.appendChild(div);
      });
    }

    window.onTributeCardsUpdated = function () {
      renderTributeCardsFeed();
      refresh302TreeHangingCards();
    };

    function openTributeTreeModal(side = 'left') {
      selectedTributeTreeSide = side;
      renderTributeCardsFeed();
      document.getElementById('tribute-tree-modal').classList.remove('hidden');
    }

    function openPayment5kModal() {
      // No misleading fake QR: a payment gateway and verified webhook are required.
      document.getElementById('payment-5k-modal')?.classList.remove('hidden');
    }

    function openPink301Modal(slotIdx = 0) {
      pink301Frames.selectedSlot = slotIdx;
      const quotaLabel = document.getElementById('pink-301-quota-label');
      if (quotaLabel) {
        quotaLabel.textContent =
          pink301HangCount === 0
            ? '🎁 Miễn phí 1 lần treo đầu tiên (Lần sau 5.000đ)'
            : '💳 Lượt treo tiếp theo yêu cầu mở khóa 5.000đ';
      }
      document.getElementById('pink-301-modal').classList.remove('hidden');
    }

    function renderGratitudeCertificate({ sender, teacher, itemLabel, note }) {
      const canvas = document.getElementById('certificate-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fffbeb';
      ctx.fillRect(0, 0, 900, 620);

      ctx.strokeStyle = '#b45309';
      ctx.lineWidth = 14;
      ctx.strokeRect(20, 20, 860, 580);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 4;
      ctx.strokeRect(36, 36, 828, 548);

      ctx.fillStyle = '#991b1b';
      ctx.font = '800 34px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('GIẤY CHỨNG NHẬN TẤM LÒNG TRI ÂN 20/11', 450, 105);

      ctx.fillStyle = '#78350f';
      ctx.font = '600 20px Inter, sans-serif';
      ctx.fillText('TRÂN TRỌNG GHI NHẬN TẤM LÒNG CỦA', 450, 175);

      ctx.fillStyle = '#be185d';
      ctx.font = '800 38px Inter, sans-serif';
      ctx.fillText((sender || 'Học Sinh Tri Ân').toUpperCase(), 450, 235);

      ctx.fillStyle = '#1e293b';
      ctx.font = '600 21px Inter, sans-serif';
      ctx.fillText(`Đã dâng tặng ${itemLabel} kính gửi tới ${teacher || 'Quý Thầy Cô'}`, 450, 295);

      ctx.fillStyle = '#475569';
      ctx.font = 'italic 19px Inter, sans-serif';
      ctx.fillText(`“${note || 'Kính chúc Quý Thầy Cô ngày 20/11 thật nhiều sức khỏe và hạnh phúc!'}”`, 450, 355, 760);

      ctx.fillStyle = '#b45309';
      ctx.font = '700 18px Inter, sans-serif';
      ctx.fillText('BAN TỔ CHỨC LỄ KỶ NIỆM NGÀY NHÀ GIÁO VIỆT NAM 20/11', 450, 515);
    }

    function downloadCertificateAsPDF() {
      const canvas = document.getElementById('certificate-canvas');
      if (!canvas) return;
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(`<html><head><title>Chứng Nhận Tri Ân 20/11</title></head><body style="margin:0;display:flex;justify-content:center;align-items:center;background:#111;"><img src="${imgData}" style="max-width:100%;height:auto;" onload="window.print();" /></body></html>`);
        win.document.close();
      } else {
        const a = document.createElement('a');
        a.href = imgData;
        a.download = 'Chung_Nhan_Tri_An_20_11.jpg';
        a.click();
      }
    }

    // =========================================================================
    // 11. ANIMATION LOOP, UI BINDINGS & INITIALIZATION
    // =========================================================================
    function animateHumanWalk(char, elapsed, speed = 8, dt = 0.016, amount = 1) {
      if (!char || !char.userData) return;
      // A seated student or the protagonist riding the scooter must not
      // inherit the normal walking gait.
      if (char.userData.isSeated || char.userData.isRiding) return;
      const data=char.userData;
      const moving=speed>0.5;
      const a=1-Math.exp(-dt*8.5);
      data.walkBlend=THREE.MathUtils.lerp(data.walkBlend||0,moving?Math.min(1,amount):0,a);
      data.walkTime=(data.walkTime||0)+dt*(speed||8);
      const swing=Math.sin(data.walkTime)*0.43*data.walkBlend;
      const secondary=Math.cos(data.walkTime)*0.09*data.walkBlend;
      if(data.leftLeg) data.leftLeg.rotation.x=swing;
      if(data.rightLeg) data.rightLeg.rotation.x=-swing;
      if(data.leftArm) data.leftArm.rotation.x=-swing*0.56;
      if(data.rightArm && !data.bouquetMesh?.visible) data.rightArm.rotation.x=swing*0.56;
      if(data.headGroup && moving) data.headGroup.rotation.z=secondary*0.1;
    }

    function animate() {
      requestAnimationFrame(animate);
      const dt = Math.min(clock ? clock.getDelta() : 0.016, 0.05);
      const elapsed = clock ? clock.getElapsedTime() : 0;

      if (skyShaderUniforms) {
        skyShaderUniforms.uTime.value = elapsed;
      }
      if (atmosphereMotes && atmosphereMotes.parent && atmosphereMotes.visible) {
        atmosphereMotes.rotation.y = Math.sin(elapsed * 0.13) * 0.045;
        atmosphereMotes.position.y = Math.sin(elapsed * 0.31) * 0.09;
      }

      if (sceneMode === 'intro') {
        const progress = Math.min(1, elapsed / 4.2);
        const bar = document.getElementById('intro-progress-bar');
        if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
        if (campusScooterGroup) {
          campusScooterGroup.position.z = 34 - progress * 16;
          scooterWheels.forEach((w) => {
            w.rotation.x -= dt * 10;
          });
        }
        camera.position.set(Math.sin(elapsed * 0.4) * 5, 7.5 - progress * 1.5, 40 - progress * 10);
        controls.target.set(0, 2.2, 22 - progress * 14);
        if (progress >= 1) {
          switchSceneMode('campus');
        }
      }

      if (campusDismountAnim && campusHero && sceneMode === 'campus') {
        const d = campusDismountAnim;
        d.elapsed = Math.min(d.duration, d.elapsed + dt);
        const u = smooth01(d.elapsed / d.duration);
        campusHero.position.set(
          THREE.MathUtils.lerp(d.startX, d.endX, u),
          0.14,
          THREE.MathUtils.lerp(d.startZ, d.endZ, u)
        );
        campusHero.rotation.y = Math.PI;
        animateHumanWalk(campusHero,elapsed,7,dt);
        if (u >= 1) {
          campusDismountAnim = null;
          resetHeroMotion();
        }
      }

      if (sceneMode === 'intro' || sceneMode === 'campus') {
        campusWaterRipples.forEach((rip) => {
          const cycle = (elapsed * 0.55 + rip.userData.phase) % 1;
          const sc = 0.65 + cycle * 1.45;
          rip.scale.set(sc, sc, 1);
          rip.material.opacity = (1 - cycle) * 0.45;
        });

        fountainWaterJets.forEach((drop) => {
          const t = (elapsed * 0.9 + drop.userData.phase) % 1;
          const rad = 0.25 + t * 1.35;
          const y = 1.45 + Math.sin(t * Math.PI) * 0.85 - t * t * 1.15;
          drop.position.set(Math.cos(drop.userData.angle) * rad, Math.max(0.28, y), Math.sin(drop.userData.angle) * rad);
        });

        campusBirds.forEach((bird) => {
          const a = elapsed * bird.userData.speed + bird.userData.phase;
          bird.position.x = Math.cos(a) * bird.userData.radius;
          bird.position.z = Math.sin(a) * (bird.userData.radius * 0.75);
          bird.rotation.y = -a;
          const flap = Math.sin(elapsed * 7.5 + bird.userData.phase) * 0.42;
          bird.userData.lWing.rotation.z = flap;
          bird.userData.rWing.rotation.z = -flap;
        });

        campusFlags.forEach((flag) => {
          flag.rotation.y = Math.sin(elapsed * 3.2) * 0.14;
        });

        campusClouds.forEach((cl) => {
          cl.position.x += dt * 0.35;
          if (cl.position.x > 65) cl.position.x = -65;
        });

        if (campusEnterBuildingAnim && campusHero) {
          campusEnterBuildingAnim.progress += dt * 0.48;
          const p = Math.min(1, campusEnterBuildingAnim.progress);
          const eased = easeInOut(p);
          const x = THREE.MathUtils.lerp(campusEnterBuildingAnim.startX, campusEnterBuildingAnim.targetX, eased);
          const z = THREE.MathUtils.lerp(campusEnterBuildingAnim.startZ, campusEnterBuildingAnim.targetZ, eased);
          campusHero.position.set(x, 0.14, z);
          campusHero.rotation.y = Math.atan2(
            campusEnterBuildingAnim.targetX - campusEnterBuildingAnim.startX,
            campusEnterBuildingAnim.targetZ - campusEnterBuildingAnim.startZ
          );
          animateHumanWalk(campusHero, elapsed, 10, dt);

          const bldg =
            campusEnterBuildingAnim.side === 'female'
              ? campusGroup.userData.femaleBuilding
              : campusGroup.userData.teacherBuilding;
          if (p > 0.65 && bldg && bldg.userData.entranceDoors) {
            const openAngle = Math.min(1, (p - 0.65) / 0.35) * (Math.PI * 0.45);
            const dir = bldg.userData.entranceDoors.outDir;
            bldg.userData.entranceDoors.left.rotation.y = dir * openAngle;
            bldg.userData.entranceDoors.right.rotation.y = -dir * openAngle;
          }

          if (p > 0.85) setSceneCurtain(true);
          if (p >= 1) {
            campusEnterBuildingAnim = null;
            hallwaySpawn = { kind: 'entrance' };
            switchSceneMode('hallway');
            // Enter through the main doorway first, then take a few steps
            // into the open lobby; do not spawn against the staircase.
            hallwayEntryAnim = { elapsed: 0, duration: 1.5, fromZ: 2.82, toZ: 2.05 };
          }
        }
      }

      if (hallwayEntryAnim && roomHero && sceneMode === 'hallway') {
        const intro = hallwayEntryAnim;
        intro.elapsed = Math.min(intro.duration, intro.elapsed + dt);
        const progress = smooth01(intro.elapsed / intro.duration);
        roomHero.position.z = THREE.MathUtils.lerp(intro.fromZ, intro.toZ, progress);
        roomHero.position.x = THREE.MathUtils.lerp(0, -0.12, progress);
        roomHero.rotation.y = Math.PI;
        animateHumanWalk(roomHero, elapsed, 7, dt);
        if (intro.elapsed >= intro.duration) {
          hallwayEntryAnim = null;
          resetHeroMotion();
        }
      }
      if (classroomWalkAnim && roomHero) {
        const a = classroomWalkAnim;
        a.progress = Math.min(1,a.progress + dt/2.0);
        const p = a.progress;
        // Move along the clear central corridor first, then approach the doorway.
        const horizontal = smooth01(Math.min(1,p/0.66));
        const forward = smooth01(Math.max(0,(p-0.12)/0.88));
        roomHero.position.x = THREE.MathUtils.lerp(a.startX,a.doorX,horizontal);
        roomHero.position.z = THREE.MathUtils.lerp(a.startZ,-3.22,forward);
        roomHero.rotation.y = Math.atan2(a.doorX-a.startX, -3.22-a.startZ);
        animateHumanWalk(roomHero,elapsed,9,dt);
        if (a.pivots) {
          const opening = smooth01((p-0.25)/0.3) * (1-smooth01((p-0.9)/0.1));
          a.pivots.left.rotation.y = -opening*0.95;
          a.pivots.right.rotation.y = opening*0.95;
        }
        if (p>0.82) setSceneCurtain(true);
        if (p>=1) switchSceneMode(a.targetRoomMode);
      }
      if (exitRoomWalkAnim && roomHero) {
        const a=exitRoomWalkAnim;
        a.progress=Math.min(1,a.progress+dt/1.9);
        const p=a.progress;
        // Exit via the central room door (x=0, z=+depth/2) without cutting through desks.
        const horizontal=smooth01(Math.min(1,p/0.57));
        const forward=smooth01(Math.max(0,(p-0.15)/0.85));
        roomHero.position.x=THREE.MathUtils.lerp(a.startX,0,horizontal);
        roomHero.position.z=THREE.MathUtils.lerp(a.startZ,(sceneMode==='room201'?6.25:sceneMode==='room301'?5.98:5.48),forward);
        roomHero.rotation.y=0;
        animateHumanWalk(roomHero,elapsed,9,dt);
        if(a.pivots){
          const open=smooth01((p-0.28)/0.32)*(1-smooth01((p-0.89)/0.11));
          a.pivots.left.rotation.y=open*0.92;
          a.pivots.right.rotation.y=-open*0.92;
        }
        if(p>0.82) setSceneCurtain(true);
        if(p>=1) switchSceneMode(a.targetHallwayMode);
      }
      if (stairClimbAnim) {
        const a=stairClimbAnim;
        const seg=a.steps[a.stage];
        if(seg && roomHero) {
          a.stageTime=Math.min(seg.seconds,a.stageTime+dt);
          const t=smooth01(a.stageTime/seg.seconds);
          const [x0,y0,z0]=seg.start;
          const [x1,y1,z1]=seg.end;
          roomHero.position.set(
            THREE.MathUtils.lerp(x0,x1,t),
            THREE.MathUtils.lerp(y0,y1,t),
            THREE.MathUtils.lerp(z0,z1,t)
          );
          const dx=x1-x0,dz=z1-z0;
          if(Math.hypot(dx,dz)>0.03){
            const desired=Math.atan2(dx,dz);
            const dyaw=((desired-roomHero.rotation.y+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
            roomHero.rotation.y+=dyaw*(1-Math.exp(-dt*8));
            if(isFirstPersonPOV) {
              const diff=((roomHero.rotation.y-fpYaw+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
              fpYaw+=diff*(1-Math.exp(-dt*9));
            }
          }
          animateHumanWalk(roomHero,elapsed,seg.name.startsWith('landing')?5:8.5,dt);
          const total=a.steps.reduce((sum,v)=>sum+v.seconds,0);
          const prior=a.steps.slice(0,a.stage).reduce((sum,v)=>sum+v.seconds,0);
          a.progress=(prior+a.stageTime)/total;
          // Only mask the floor swap after ALL steps and the landing are shown.
          if(a.progress>0.970)setSceneCurtain(true);
          if(a.stageTime>=seg.seconds) {
            a.stage++;
            a.stageTime=0;
            if(a.stage>=a.steps.length){
              const next=a.targetHallwayMode;
              hallwaySpawn={kind:'stairs',x:a.exitX,z:1.64};
              stairClimbAnim=null;
              switchSceneMode(next);
            }
          }
        }
      }
      if (room101GiftAnim && roomHero && room101Teacher) updateGiftCeremony(room101GiftAnim,dt,elapsed);
      if (room301GiftAnim && roomHero && room301Teacher) updateGiftCeremony(room301GiftAnim,dt,elapsed);
      if (giftBloom) {
        giftBloom.time += dt;
        if (giftBloom.time >= 0.7) giftBloom = null;
      }

      animateRoom103Reader(dt,elapsed);

      if (sceneMode === 'room201') {
        room201Performers.forEach((p, idx) => {
          p.position.y = 0.65 + Math.abs(Math.sin(elapsed * 4 + idx)) * 0.06;
          if (p.userData.leftArm) p.userData.leftArm.rotation.z = -0.35 + Math.sin(elapsed * 3.5 + idx) * 0.25;
          if (p.userData.rightArm) p.userData.rightArm.rotation.z = 0.35 - Math.sin(elapsed * 3.5 + idx) * 0.25;
        });
        room201Audience.forEach((a) => {
          if (a.mesh && a.mesh.userData && a.mesh.userData.headGroup) {
            a.mesh.userData.headGroup.rotation.x = Math.sin(elapsed * 3 + a.phase) * 0.06;
          }
        });
      }

      // Gentle breathing / head-nodding life across all classroom & hallway characters
      activeIdleCharacters.forEach((item) => {
        if (!item.mesh || !item.mesh.parent || !item.mesh.parent.visible) return;
        if (item.mesh.userData && item.mesh.userData.headGroup) {
          item.mesh.userData.headGroup.rotation.y = Math.sin(elapsed * 1.4 + item.phase) * 0.14;
        }
      });

      // Accelerated, frame-rate-independent player movement and collisions.
      if (roomHero && sceneMode !== 'intro' && sceneMode !== 'campus') {
        // First-person: W/A/S/D and arrows move relative to the viewer's yaw.
        // Shift increases walking speed, with the same axis-separated collisions.
        const canControl = !activeTransition() && !room102SlidePointer &&
          !document.querySelector('.fixed.inset-0.z-50:not(.hidden)');
        let ax=0,az=0;
        if(canControl){
          if(keysPressed.KeyW || keysPressed.ArrowUp) az+=1;
          if(keysPressed.KeyS || keysPressed.ArrowDown) az-=1;
          if(keysPressed.KeyA || keysPressed.ArrowLeft) ax-=1;
          if(keysPressed.KeyD || keysPressed.ArrowRight) ax+=1;
        }
        const length=Math.hypot(ax,az);
        if(length>0){ax/=length;az/=length;}
        const desiredX = isFirstPersonPOV ? Math.sin(fpYaw)*az + Math.cos(fpYaw)*ax : ax;
        const desiredZ = isFirstPersonPOV ? Math.cos(fpYaw)*az - Math.sin(fpYaw)*ax : -az;
        const running = isFirstPersonPOV && (keysPressed.ShiftLeft || keysPressed.ShiftRight);
        const topSpeed = running ? 3.70 : isFirstPersonPOV ? 2.60 : 2.65;
        const accel = 1-Math.exp(-dt * (length ? 11 : 13));
        heroVelocity.x=THREE.MathUtils.lerp(heroVelocity.x,desiredX*topSpeed,accel);
        heroVelocity.z=THREE.MathUtils.lerp(heroVelocity.z,desiredZ*topSpeed,accel);
        if(!canControl) heroVelocity.multiplyScalar(Math.exp(-dt*25));
        const xx=roomHero.position.x+heroVelocity.x*dt;
        const zz=roomHero.position.z+heroVelocity.z*dt;
        // Axis separation gives natural sliding against desk edges, rather than teleporting.
        if(avatarCanOccupy(xx,roomHero.position.z)) roomHero.position.x=xx;
        else heroVelocity.x=0;
        if(avatarCanOccupy(roomHero.position.x,zz)) roomHero.position.z=zz;
        else heroVelocity.z=0;
        const speed=heroVelocity.length();
        if(speed>0.12 && !activeTransition()){
          const desiredYaw = Math.atan2(heroVelocity.x,heroVelocity.z);
          let delta=((desiredYaw-roomHero.rotation.y+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
          roomHero.rotation.y += delta*(1-Math.exp(-dt*12));
        }
        if(!activeTransition()) animateHumanWalk(roomHero,elapsed,speed>0.07?8:0,dt,speed/(running?3.70:isFirstPersonPOV?2.60:2.65));
      }

      ceilingFans.forEach((fan) => {
        if (fan.parent && fan.parent.visible) {
          fan.rotation.y += dt * 4.5;
        }
      });

      floatingPetals.forEach((petal) => {
        petal.position.y -= dt * petal.userData.speedY;
        petal.position.x += Math.sin(elapsed * petal.userData.swaySpeed + petal.userData.phase) * dt * 0.45;
        petal.rotation.x += dt * 1.4;
        petal.rotation.y += dt * 1.1;
        if (petal.position.y < 0.2) petal.position.y = 14 + Math.random() * 4;
      });

      if (roomHero && sceneMode !== 'intro' && sceneMode !== 'campus' && isFirstPersonPOV) {
        roomHero.visible = false;
        updatePOVCamera(1-Math.exp(-dt*16));
      } else {
        if (!isFirstPersonPOV && roomHero && sceneMode !== 'campus' && sceneMode !== 'intro') {
          roomHero.visible = true;
          const activeGift = room101GiftAnim || room301GiftAnim;
          if (stairClimbAnim) {
            const currentY = roomHero.position.y;
            const viewY = stairClimbAnim.goingUp ? Math.max(2.7,currentY+1.75)
              : Math.max(-2.4,currentY+2.4);
            camera.position.lerp(new THREE.Vector3(stairClimbAnim.shaftX+4.0,viewY,3.0),1-Math.exp(-dt*3.1));
            controls.target.lerp(new THREE.Vector3(stairClimbAnim.shaftX,currentY+1.12,-0.95),1-Math.exp(-dt*3.1));
          }
          if (activeGift) {
            // A composed third-person shot: both faces and the bouquet remain visible.
            const b=activeGift.whichRoom==='room101';
            const desirePos=new THREE.Vector3(b?2.85:-2.6,2.6,b?0.65:0.3);
            const desireTarget=new THREE.Vector3(0,1.32,b?-3.3:-3.5);
            camera.position.lerp(desirePos,1-Math.exp(-dt*2.4));
            controls.target.lerp(desireTarget,1-Math.exp(-dt*2.4));
          }
          // Keep camera inside actual geometry; the original +/- 9 m camera bounds
          // allowed the orbit to pass through walls and lose visibility.
          const hall=sceneMode.startsWith('hallway');
          const limX=hall?12.55:({room201:7.5,room301:7.05,room302:7.3}[sceneMode]||6.35);
          const limZ=hall?3.3:({room201:6.25,room301:6.0,room302:5.9}[sceneMode]||5.38);
          camera.position.x=THREE.MathUtils.clamp(camera.position.x,-limX,limX);
          camera.position.z=THREE.MathUtils.clamp(camera.position.z,-limZ,limZ);
          camera.position.y=stairClimbAnim
            ? THREE.MathUtils.clamp(camera.position.y,-2.5,6.6)
            : THREE.MathUtils.clamp(camera.position.y,1.65,hall?3.55:3.4);
        } else if (SCENE_CAMERA_BOUNDS[sceneMode]) {
          const b=SCENE_CAMERA_BOUNDS[sceneMode];
          camera.position.x=THREE.MathUtils.clamp(camera.position.x,b.minX,b.maxX);
          camera.position.y=THREE.MathUtils.clamp(camera.position.y,b.minY,b.maxY);
          camera.position.z=THREE.MathUtils.clamp(camera.position.z,b.minZ,b.maxZ);
        }
        controls.update();
      }

      updateRoom102SlideAnimation(dt);
      updateEnhancedHumanoids(dt);
      updatePOVViewmodel(elapsed);
      renderer.render(scene, camera);
    }

    function bindUIEvents() {
      const skipBtn = document.getElementById('btn-skip-intro');
      if (skipBtn) skipBtn.addEventListener('click', () => switchSceneMode('campus'));

      const enterTeacherBtn = document.getElementById('btn-enter-teacher-bldg');
      if (enterTeacherBtn) enterTeacherBtn.addEventListener('click', () => startEnterBuildingSequence('teacher'));

      const enterFemaleBtn = document.getElementById('btn-enter-female-bldg');
      if (enterFemaleBtn) enterFemaleBtn.addEventListener('click', () => startEnterBuildingSequence('female'));

      window.addEventListener('keydown', (e) => {
        const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'') || document.activeElement?.isContentEditable;
        if(typing) return;
        if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code) ||
          (isFirstPersonPOV && !e.ctrlKey && !e.metaKey &&
          ['KeyW','KeyA','KeyS','KeyD'].includes(e.code))) e.preventDefault();
        keysPressed[e.code] = true;
      });
      window.addEventListener('keyup', e => { keysPressed[e.code]=false; });
      window.addEventListener('blur',()=>{Object.keys(keysPressed).forEach(k=>keysPressed[k]=false);isPointerDragging=false;});

      // Capture slide gestures BEFORE OrbitControls / first-person drag.
      // Dragging a real 3D board never rotates the camera or opens a popup.
      renderer.domElement.addEventListener('pointerdown', (e) => {
        if (sceneMode !== 'room102' || !room102SlideMesh || activeTransition() ||
            room102SlideState?.motion || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const rect=renderer.domElement.getBoundingClientRect();
        const p=new THREE.Vector2(
          ((e.clientX-rect.left)/rect.width)*2-1,
          -((e.clientY-rect.top)/rect.height)*2+1
        );
        const rc=new THREE.Raycaster();
        rc.setFromCamera(p,camera);
        const hit=rc.intersectObject(room102SlideMesh,false)[0];
        if(!hit) return;
        room102SlidePointer={
          id:e.pointerId,x:e.clientX,deltaX:0,uv:hit.uv?.x ?? 0.5,
          originalOrbitEnabled:controls.enabled
        };
        if(!isFirstPersonPOV) controls.enabled=false;
        isPointerDragging=false;
        renderer.domElement.setPointerCapture?.(e.pointerId);
        e.preventDefault();
        e.stopImmediatePropagation();
      }, {capture:true});

      // 360-degree look-around when First-Person POV is active
      renderer.domElement.addEventListener('pointerdown', (e) => {
        isPointerDragging = true;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        if (isFirstPersonPOV) renderer.domElement.setPointerCapture?.(e.pointerId);
      });
      window.addEventListener('pointermove', (e) => {
        if(room102SlidePointer){
          if(e.pointerId!==room102SlidePointer.id) return;
          const dx=e.clientX-room102SlidePointer.x;
          room102SlidePointer.deltaX=dx;
          const width=Math.max(170,Math.min(450,renderer.domElement.clientWidth*0.42));
          room102SlidePointer.offset=THREE.MathUtils.clamp(dx/width,-0.94,0.94);
          paintRoom102Slide(room102SlidePointer.offset);
          e.preventDefault();
          return;
        }
        if (!isPointerDragging) return;
        const dx = e.clientX - lastPointerX;
        const dy = e.clientY - lastPointerY;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        if (isFirstPersonPOV && sceneMode !== 'intro' && sceneMode !== 'campus') {
          fpYaw -= dx * 0.0045;
          fpPitch = THREE.MathUtils.clamp(fpPitch - dy * 0.0035, -0.75, 0.75);
        }
      });
      window.addEventListener('pointerup', (e) => {
        const gesture=room102SlidePointer;
        if(gesture && e.pointerId===gesture.id){
          room102SlidePointer=null;
          if(!isFirstPersonPOV) controls.enabled=gesture.originalOrbitEnabled;
          const dx=gesture.deltaX||0;
          const offset=gesture.offset||0;
          if(Math.abs(offset)>0.19 || Math.abs(dx)>48){
            changeRoom102Slide(dx<0?1:-1,offset);
          } else if(Math.abs(dx)>13){
            changeRoom102Slide(0,offset);
          } else {
            changeRoom102Slide(gesture.uv<0.33?-1:1,offset);
          }
          slideIgnoreClickUntil=performance.now()+500;
          e.preventDefault();
        }
        isPointerDragging=false;
      });
      window.addEventListener('pointercancel', (e) => {
        if(room102SlidePointer && room102SlidePointer.id===e.pointerId) {
          const offset=room102SlidePointer.offset||0;
          if(!isFirstPersonPOV) controls.enabled=room102SlidePointer.originalOrbitEnabled;
          room102SlidePointer=null;
          changeRoom102Slide(0,offset);
        }
        isPointerDragging=false;
      });

      const backBtn = document.getElementById('btn-back');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          if (sceneMode === 'room101') startExitRoomWalk('hallway', -9.2);
          else if (sceneMode === 'room102') startExitRoomWalk('hallway', -4.6);
          else if (sceneMode === 'room103') startExitRoomWalk('hallway', 6.8);
          else if (sceneMode === 'room201') startExitRoomWalk('hallway2', -6.8);
          else if (sceneMode === 'room202') startExitRoomWalk('hallway2', 6.8);
          else if (sceneMode === 'room301') startExitRoomWalk('hallway3', -6.8);
          else if (sceneMode === 'room302') startExitRoomWalk('hallway3', 6.8);
          else if (sceneMode === 'hallway3') startStairClimb('hallway2', false);
          else if (sceneMode === 'hallway2') startStairClimb('hallway', false);
          else if (sceneMode === 'hallway') startExitBuildingToCampus();
        });
      }

      function chooseCamera(pov) {
        if(sceneMode==='campus'||sceneMode==='intro') {
          if(pov) showSpeechCard('Góc máy người tặng','Hãy vào một phòng học để sử dụng camera đặt tại vị trí học sinh.');
          return;
        }
        if(isFirstPersonPOV===pov) return;
        if(!isFirstPersonPOV && controls) {
          cameraState.overview.position.copy(camera.position);
          cameraState.overview.target.copy(controls.target);
          cameraState.overviewScene=sceneMode;
        }
        isFirstPersonPOV=pov;
        if(pov) {
          fpYaw=roomHero?.rotation.y ?? Math.PI;
          fpPitch=-0.04;
          renderer.domElement.tabIndex=0;
          renderer.domElement.focus?.({preventScroll:true});
        }
        applyInteriorCameraView(true);
        playChime(pov?540:660,0.13);
      }
      const btnOverview=document.getElementById('btn-camera-overview');
      const btnDonor=document.getElementById('btn-camera-donor');
      if(btnOverview) btnOverview.addEventListener('click',()=>chooseCamera(false));
      if(btnDonor) {
        btnDonor.title='Góc người tặng hoa: W/A/S/D hoặc phím mũi tên để di chuyển; giữ Shift để chạy; kéo chuột để nhìn.';
        btnDonor.addEventListener('click',()=>chooseCamera(true));
      }
      const audioBtn=document.getElementById('btn-audio-toggle');
      if(audioBtn) audioBtn.addEventListener('click',()=>{
        audioEnabled=!audioEnabled;
        audioBtn.textContent=audioEnabled?'🔊 Âm thanh':'🔇 Tắt tiếng';
        audioBtn.setAttribute('aria-pressed',String(audioEnabled));
        if(!audioEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
        if(audioEnabled) playChime(720,0.12);
      });
      const replayVoice=document.getElementById('btn-replay-voice');
      if(replayVoice) replayVoice.addEventListener('click',()=>speakVietnamese(lastSpeechText || document.getElementById('speech-text')?.textContent || ''));

      const gfxBtn = document.getElementById('btn-toggle-gfx');
      if (gfxBtn) {
        gfxBtn.addEventListener('click', () => {
          graphicsUltra = !graphicsUltra;
          const lbl = document.getElementById('gfx-toggle-label');
          if (lbl) lbl.textContent = graphicsUltra ? 'Ultra' : 'Cao';
          applyGraphicsQuality();
          configureLightingForMode(sceneMode);
          playChime(graphicsUltra ? 760 : 520, 0.14);
        });
      }

      const closeSpeech = document.getElementById('btn-close-speech');
      if (closeSpeech) closeSpeech.addEventListener('click', hideSpeechCard);

      ['btn-close-chalk', 'btn-cancel-chalk'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => document.getElementById('chalkboard-modal').classList.add('hidden'));
      });
      const saveChalk = document.getElementById('btn-save-chalk');
      if (saveChalk) {
        saveChalk.addEventListener('click', () => {
          const val = (document.getElementById('chalk-wish-input').value || '').trim();
          if (val) {
            room101SavedWishes.push(val);
            updateRoom101ChalkboardWish(val);
            showSpeechCard('Lời Chúc Đã Khắc Lên Bảng 3D', `“${val}”`);
            playChime(700, 0.18);
          }
          document.getElementById('chalkboard-modal').classList.add('hidden');
        });
      }

      ['btn-close-mag', 'btn-ok-mag'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => document.getElementById('magazine-modal').classList.add('hidden'));
      });

      ['btn-close-art', 'btn-ok-art'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => document.getElementById('artwork-modal').classList.add('hidden'));
      });

      const closeAnth = document.getElementById('btn-close-anthology');
      if (closeAnth) closeAnth.addEventListener('click', () => {
        document.getElementById('anthology-modal').classList.add('hidden');
        anthologySwipeStart=null;
      });
      document.querySelectorAll('.anthology-tab').forEach((tab) => {
        tab.addEventListener('click', () => openAnthologyModal(Number(tab.getAttribute('data-book') || 0), 0));
      });
      const prevAnth = document.getElementById('btn-prev-anthology');
      if (prevAnth) prevAnth.addEventListener('click', () => openAnthologyModal(currentAnthologyBookIdx, currentAnthologyPageIdx - 1));
      const nextAnth = document.getElementById('btn-next-anthology');
      if (nextAnth) nextAnth.addEventListener('click', () => openAnthologyModal(currentAnthologyBookIdx, currentAnthologyPageIdx + 1));
      const anthologyShell=document.getElementById('anthology-book-shell');
      if(anthologyShell) {
        anthologyShell.addEventListener('pointerdown',e=>{
          anthologySwipeStart={id:e.pointerId,x:e.clientX,y:e.clientY};
        });
        anthologyShell.addEventListener('pointerup',e=>{
          if(!anthologySwipeStart || e.pointerId!==anthologySwipeStart.id)return;
          const dx=e.clientX-anthologySwipeStart.x;
          const dy=e.clientY-anthologySwipeStart.y;
          anthologySwipeStart=null;
          if(Math.abs(dx)>55 && Math.abs(dx)>Math.abs(dy)*1.2)
            openAnthologyModal(currentAnthologyBookIdx,currentAnthologyPageIdx+(dx<0?1:-1));
        });
        anthologyShell.addEventListener('pointercancel',()=>{anthologySwipeStart=null;});
      }
      window.addEventListener('keydown',e=>{
        const modal=document.getElementById('anthology-modal');
        if(!modal||modal.classList.contains('hidden'))return;
        if(e.code==='ArrowRight'||e.code==='ArrowLeft'){
          e.preventDefault();e.stopPropagation();
          openAnthologyModal(currentAnthologyBookIdx,currentAnthologyPageIdx+(e.code==='ArrowRight'?1:-1));
        }else if(e.code==='Escape'){
          e.preventDefault();modal.classList.add('hidden');
        }
      },true);

      ['btn-close-photo-zoom', 'btn-ok-photo-zoom'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => document.getElementById('photo-zoom-modal').classList.add('hidden'));
      });
      const zoomIn = document.getElementById('btn-zoom-in');
      if (zoomIn) {
        zoomIn.addEventListener('click', () => {
          currentPhotoZoom = Math.min(2.4, currentPhotoZoom + 0.25);
          document.getElementById('photo-zoom-img').style.transform = `scale(${currentPhotoZoom})`;
          document.getElementById('photo-zoom-badge').textContent = `${Math.round(currentPhotoZoom * 100)}%`;
        });
      }
      const zoomOut = document.getElementById('btn-zoom-out');
      if (zoomOut) {
        zoomOut.addEventListener('click', () => {
          currentPhotoZoom = Math.max(0.75, currentPhotoZoom - 0.25);
          document.getElementById('photo-zoom-img').style.transform = `scale(${currentPhotoZoom})`;
          document.getElementById('photo-zoom-badge').textContent = `${Math.round(currentPhotoZoom * 100)}%`;
        });
      }
      const zoomReset = document.getElementById('btn-zoom-reset');
      if (zoomReset) {
        zoomReset.addEventListener('click', () => {
          currentPhotoZoom = 1;
          document.getElementById('photo-zoom-img').style.transform = 'scale(1)';
          document.getElementById('photo-zoom-badge').textContent = '100%';
        });
      }
      const voicePhoto = document.getElementById('btn-voice-photo');
      if (voicePhoto) {
        voicePhoto.addEventListener('click', () => {
          const item = ROOM301_PHOTOS[currentPhotoIdx301];
          if (item) speakVietnamese(`${item.title}. ${item.desc}`);
        });
      }

      const closeTreeModal = document.getElementById('btn-close-tribute-modal');
      if (closeTreeModal) closeTreeModal.addEventListener('click', () => document.getElementById('tribute-tree-modal').classList.add('hidden'));
      const selLeft = document.getElementById('btn-select-tree-left');
      if (selLeft) selLeft.addEventListener('click', () => { selectedTributeTreeSide = 'left'; });
      const selRight = document.getElementById('btn-select-tree-right');
      if (selRight) selRight.addEventListener('click', () => { selectedTributeTreeSide = 'right'; });

      const submitCardBtn = document.getElementById('btn-submit-tribute-card');
      if (submitCardBtn) {
        submitCardBtn.addEventListener('click', async () => {
          const teacherName = (document.getElementById('tribute-teacher-input').value || '').trim() || 'Quý Thầy Cô';
          const message = (document.getElementById('tribute-message-input').value || '').trim();
          const senderName = (document.getElementById('tribute-sender-input').value || '').trim() || 'Học trò';
          if (!message) return;
          if (window.TributeCloud) {
            const res = await window.TributeCloud.addTributeCard({
              treeSide: selectedTributeTreeSide,
              teacherName,
              message,
              senderName
            });
            if (!res.ok && res.reason === 'PAYMENT_REQUIRED') {
              openPayment5kModal();
              return;
            }
            document.getElementById('tribute-message-input').value = '';
            playChime(760, 0.2);
          }
        });
      }

      const openBuySlot = document.getElementById('btn-open-buy-slot');
      if (openBuySlot) openBuySlot.addEventListener('click', openPayment5kModal);

      const copyLinkBtn = document.getElementById('btn-copy-share-link');
      if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', () => {
          const tmp = document.createElement('input');
          tmp.value = window.location.href;
          document.body.appendChild(tmp);
          tmp.select();
          document.execCommand('copy');
          document.body.removeChild(tmp);
          showSpeechCard('Đã Sao Chép Liên Kết', 'Link lưu chung thiệp tri ân đã được sao chép vào bộ nhớ tạm!');
        });
      }

      ['btn-close-pay5k', 'btn-cancel-pay5k'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => document.getElementById('payment-5k-modal').classList.add('hidden'));
      });
      const confirmPay5k = document.getElementById('btn-confirm-pay5k');
      if (confirmPay5k) {
        confirmPay5k.disabled = true;
        confirmPay5k.title='Chưa có máy chủ xác nhận giao dịch — không thể tự cộng lượt.';
        confirmPay5k.textContent='Chưa hỗ trợ thanh toán';
      }

      ['btn-close-pink301', 'btn-cancel-pink301'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => document.getElementById('pink-301-modal').classList.add('hidden'));
      });
      const tabPhoto = document.getElementById('tab-p301-photo');
      const tabWish = document.getElementById('tab-p301-wish');
      if (tabPhoto && tabWish) {
        tabPhoto.addEventListener('click', () => {
          pink301ActiveTab = 'photo';
          document.getElementById('p301-photo-panel').classList.remove('hidden');
          document.getElementById('p301-wish-panel').classList.add('hidden');
        });
        tabWish.addEventListener('click', () => {
          pink301ActiveTab = 'wish';
          document.getElementById('p301-wish-panel').classList.remove('hidden');
          document.getElementById('p301-photo-panel').classList.add('hidden');
        });
      }
      const fileInp = document.getElementById('p301-file-input');
      if (fileInp) {
        fileInp.addEventListener('change', (e) => {
          const f = e.target.files && e.target.files[0];
          if (!f) return;
          document.getElementById('p301-file-name').textContent = f.name;
          const reader = new FileReader();
          reader.onload = () => {
            pink301PendingDataURL = reader.result;
          };
          reader.readAsDataURL(f);
        });
      }
      const hangBtn = document.getElementById('btn-hang-pink301');
      if (hangBtn) {
        hangBtn.addEventListener('click', () => {
          if (pink301HangCount >= 1) {
            openPayment5kModal();
            return; // Do not hang an unpaid image and continue anyway.
          }
          const slotIdx = pink301Frames.selectedSlot || 0;
          const targetMesh = pink301Frames[slotIdx] || pink301Frames[0];
          if (targetMesh) {
            if (pink301ActiveTab === 'photo' && pink301PendingDataURL) {
              const tex = new THREE.TextureLoader().load(pink301PendingDataURL);
              tex.encoding = THREE.sRGBEncoding;
              targetMesh.material.map = tex;
              targetMesh.material.needsUpdate = true;
            } else {
              const wishText = document.getElementById('p301-wish-select').value;
              const author = document.getElementById('p301-wish-author').value || 'Học trò 20/11';
              const tex = makeCanvasTexture(`wish_301_${Date.now()}`, 512, 360, (ctx, w, h) => {
                ctx.fillStyle = '#831843';
                ctx.fillRect(0, 0, w, h);
                ctx.strokeStyle = '#facc15';
                ctx.lineWidth = 10;
                ctx.strokeRect(12, 12, w - 24, h - 24);
                ctx.fillStyle = '#fef08a';
                ctx.font = '700 22px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(wishText.slice(0, 42), w / 2, 150);
                ctx.fillText(wishText.slice(42, 84), w / 2, 190);
                ctx.fillStyle = '#fbcfe8';
                ctx.font = '600 18px Inter, sans-serif';
                ctx.fillText(`— ${author}`, w / 2, 270);
              });
              targetMesh.material.map = tex;
              targetMesh.material.needsUpdate = true;
            }
          }
          pink301HangCount += 1;
          document.getElementById('pink-301-modal').classList.add('hidden');
          playChime(740, 0.2);
        });
      }

      ['btn-close-pink302', 'btn-cancel-pink302'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => document.getElementById('pink-302-modal').classList.add('hidden'));
      });
      document.querySelectorAll('.p302-item-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          pink302SelectedItem = btn.getAttribute('data-item') || 'flower';
          document.querySelectorAll('.p302-item-btn').forEach((b) => b.classList.remove('border-2', 'border-pink-400', 'bg-pink-500/25'));
          btn.classList.add('border-2', 'border-pink-400', 'bg-pink-500/25');
        });
      });
      const buyPlace302 = document.getElementById('btn-buy-place-p302');
      if (buyPlace302) {
        buyPlace302.addEventListener('click', () => {
          const sender = (document.getElementById('p302-sender-input').value || '').trim() || 'Học Sinh Tri Ân';
          const teacher = (document.getElementById('p302-teacher-input').value || '').trim() || 'Thầy A & Cô B';
          const note = (document.getElementById('p302-note-input').value || '').trim();
          const itemLabels = { flower: 'Đóa Hoa Tươi Thắm', gift: 'Gói Quà Tri Ân', letter: 'Bức Thư Tay 20/11' };

          if (pink302TableGroup) {
            // Allocate slots across the table in two rows; do not stack objects atop each other.
            const itemIndex=pink302PlacedCount % 10;
            const ox=-2.06+(itemIndex % 5)*1.03;
            const oz=(Math.floor(itemIndex/5)===0?-0.55:0.55);
            pink302PlacedCount += 1;
            let obj3d;
            if (pink302SelectedItem === 'flower') {
              obj3d = createFlowerBouquet();
              obj3d.scale.set(1.4, 1.4, 1.4);
            } else if (pink302SelectedItem === 'gift') {
              obj3d = new THREE.Mesh(
                new THREE.BoxGeometry(0.45, 0.36, 0.45),
                new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.35 })
              );
              obj3d.position.y = 0.18;
            } else {
              obj3d = new THREE.Mesh(
                new THREE.BoxGeometry(0.48, 0.04, 0.32),
                new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.4 })
              );
              obj3d.position.y = 0.02;
            }
            obj3d.position.x = ox;
            obj3d.position.z = oz;
            if(pink302PlacedCount > 10 && pink302TableGroup.children.length >= 10){
              const previous=pink302TableGroup.children[itemIndex];
              if(previous) pink302TableGroup.remove(previous);
            }
            pink302TableGroup.add(obj3d);
          }

          document.getElementById('pink-302-modal').classList.add('hidden');
          renderGratitudeCertificate({
            sender,
            teacher,
            itemLabel: itemLabels[pink302SelectedItem] || 'Đóa Hoa Tri Ân',
            note
          });
          document.getElementById('certificate-pdf-modal').classList.remove('hidden');
          playChime(860, 0.25);
        });
      }

      ['btn-close-cert', 'btn-ok-cert'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => document.getElementById('certificate-pdf-modal').classList.add('hidden'));
      });
      const dlCert = document.getElementById('btn-download-cert-pdf');
      if (dlCert) dlCert.addEventListener('click', downloadCertificateAsPDF);

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      renderer.domElement.addEventListener('click', (e) => {
        if (performance.now()<slideIgnoreClickUntil) return;
        if (sceneMode === 'intro' || activeTransition()) return;
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(interactiveList, false);
        if (hits.length === 0) return;
        const type = hits[0].object.userData?.interactiveType;
        if (!type) return;

        if (type === 'enter_teacher_bldg') startEnterBuildingSequence('teacher');
        else if (type === 'enter_female_bldg') startEnterBuildingSequence('female');
        else if (type === 'exit_to_campus') startExitBuildingToCampus();
        else if (type === 'enter_101') startEnterClassroomWalk('room101', -9.2);
        else if (type === 'enter_102') startEnterClassroomWalk('room102', -4.6);
        else if (type === 'enter_103') startEnterClassroomWalk('room103', 6.8);
        else if (type === 'enter_201') startEnterClassroomWalk('room201', -6.8);
        else if (type === 'enter_202') startEnterClassroomWalk('room202', 6.8);
        else if (type === 'enter_301') startEnterClassroomWalk('room301', -6.8);
        else if (type === 'enter_302') startEnterClassroomWalk('room302', 6.8);
        else if (type === 'exit_to_hallway1') startExitRoomWalk('hallway', lastExitedDoorX || -9.2);
        else if (type === 'exit_to_hallway2') startExitRoomWalk('hallway2', lastExitedDoorX || -6.8);
        else if (type === 'exit_to_hallway3') startExitRoomWalk('hallway3', lastExitedDoorX || -6.8);
        else if (type === 'stairs_up_2') startStairClimb('hallway2', true);
        else if (type === 'stairs_up_3') startStairClimb('hallway3', true);
        else if (type === 'stairs_down_2') startStairClimb('hallway2', false);
        else if (type === 'stairs_down_1') startStairClimb('hallway', false);
        else if (type === 'gift_teacher_101') triggerRoom101Gift();
        else if (type === 'gift_teacher_301') triggerRoom301Gift();
        else if (type === 'talk_decor_student') triggerTalkDecorStudent();
        else if (type === 'chalkboard_wish') document.getElementById('chalkboard-modal').classList.remove('hidden');
        else if (type === 'room102_slide_touch') changeRoom102Slide(1);
        else if (type === 'open_wall_newspaper') document.getElementById('magazine-modal').classList.remove('hidden');
        else if (type === 'view_artwork') openArtworkViewer(hits[0].object.userData.artIndex || 0);
        else if (type === 'open_anthology') openAnthologyModal(hits[0].object.userData.bookIndex || 0, 0);
        else if (type === 'zoom_photo_301') openPhotoZoomModal(hits[0].object.userData.photoIndex || 0);
        else if (type === 'open_tribute_tree') openTributeTreeModal(hits[0].object.userData.treeSide || 'left');
        else if (type === 'greet_boardroom_teacher') {
          showSpeechCard(hits[0].object.userData.teacherLabel || 'Hội Đồng Giáo Viên', 'Chúc các em học sinh luôn chăm ngoan, học giỏi và giữ mãi tình cảm đẹp dưới mái trường thân yêu!');
        } else if (type === 'inspect_honor_plaque') {
          showSpeechCard('Bảng Vàng Danh Dự 20/11', hits[0].object.userData.honorTitle || 'Vinh danh thành tích xuất sắc của Quý Thầy Cô.');
        } else if (type === 'open_pink301_modal') openPink301Modal(hits[0].object.userData.slotIndex || 0);
        else if (type === 'open_pink302_modal') document.getElementById('pink-302-modal').classList.remove('hidden');
      });
    }

    function initThreeScene() {
      const container = document.getElementById('canvas-container');
      scene = new THREE.Scene();
      clock = new THREE.Clock();

      camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.12, 240);
      camera.position.set(0, 12.5, 34);

      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.domElement.setAttribute('aria-label','Thế giới 3D tương tác trường học 20 tháng 11');
      // Prevent browser touch-panning from competing with POV and on-board slide swipes.
      renderer.domElement.style.touchAction = 'none';
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.4));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.92;
      container.appendChild(renderer.domElement);
      scene.add(camera);
      buildPOVViewmodel();
      applyGraphicsQuality();

      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;
      controls.maxPolarAngle = Math.PI * 0.49;

      hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x365314, 0.62);
      scene.add(hemiLight);

      sunLight = new THREE.DirectionalLight(0xfffbeb, 1.28);
      sunLight.position.set(28, 42, 26);
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(2048, 2048);
      sunLight.shadow.bias = -0.00016;
      sunLight.shadow.normalBias = 0.014;
      sunLight.shadow.radius = 2.1;
      sunLight.shadow.camera.near = 2;
      sunLight.shadow.camera.far = 130;
      const d = 36;
      sunLight.shadow.camera.left = -d;
      sunLight.shadow.camera.right = d;
      sunLight.shadow.camera.top = d;
      sunLight.shadow.camera.bottom = -d;
      scene.add(sunLight);

      fillLight = new THREE.DirectionalLight(0xfde68a, 0.25);
      fillLight.position.set(-20, 16, -18);
      scene.add(fillLight);

      scene.add(
        campusGroup,
        hallwayGroup,
        classroomGroup,
        hallway2Group,
        auditoriumGroup,
        hallway3Group,
        floor3RoomGroup
      );

      createSkyDomeAndEnvMap();
      initFloatingPetals();
      bindUIEvents();
      updatePOVButtonUI();

      window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        applyGraphicsQuality();
      });

      switchSceneMode('intro');
    }

    window.onload = function () {
      try {
        initThreeScene();
        animate();
      } catch (error) {
        console.error('Lỗi khởi tạo thế giới 3D:', error);
        const holder=document.getElementById('canvas-container');
        if(holder) {
          const msg=document.createElement('div');
          msg.style.cssText='position:absolute;inset:0;display:grid;place-items:center;padding:24px;background:#09111f;color:#e2e8f0;text-align:center;z-index:100;font:600 15px/1.7 Inter,sans-serif';
          msg.textContent='Không khởi tạo được thế giới 3D. Hãy mở trang khi có Internet để tải Three.js, bật WebGL và xem Console để biết lỗi cụ thể.';
          holder.appendChild(msg);
        }
      }
    };