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
    let floatingLabelsData = [];
    let lastExitedDoorX = 0;
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
    let floatingPetals = [];
    let activeIdleCharacters = [];

    let campusGateReplayAnim = null;
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
    let currentSlideIdx = 0;
    let currentAnthologyBookIdx = 0;
    let currentAnthologyPageIdx = 0;

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
      return transitionLock || !!(classroomWalkAnim || exitRoomWalkAnim || stairClimbAnim || room101GiftAnim || room301GiftAnim || campusEnterBuildingAnim);
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
      const reach=g ? smooth01((g.progress-0.54)/0.23)*(1-smooth01((g.progress-0.79)/0.15)) : 0;
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

    function speakVietnamese(text) {
      lastSpeechText = String(text || '').trim();
      if (!audioEnabled || !lastSpeechText || !('speechSynthesis' in window)) return;
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(lastSpeechText);
        const voices = window.speechSynthesis.getVoices();
        const vn = voices.find(v => /^vi[-_]/i.test(v.lang)) || voices.find(v => /viet/i.test(v.name));
        if (vn) u.voice = vn;
        u.lang = 'vi-VN'; u.rate = 0.88; u.pitch = 1.01; u.volume = 1;
        u.onstart = () => { speechPlaying = true; };
        u.onend = u.onerror = () => { speechPlaying = false; };
        window.speechSynthesis.speak(u);
        // Chrome can leave speechSynthesis paused after its first interaction.
        window.speechSynthesis.resume();
      } catch (e) { speechPlaying = false; console.warn('Thuyết minh:', e); }
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
      const m = document.getElementById('camera-mode-info');
      if (m) m.textContent = isFirstPersonPOV ? 'POV • Mắt người tặng hoa' : 'Cam toàn cảnh • Tự do xoay';
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
      const isOutdoor = mode === 'intro' || mode === 'campus';
      if (isOutdoor) {
        hemiLight.intensity = 0.68;
        sunLight.intensity = 1.24;
        fillLight.intensity = 0.34;
        if (scene) scene.fog = new THREE.FogExp2(0xdbeafe, graphicsUltra ? 0.0042 : 0.0025);
        if (renderer) renderer.toneMappingExposure = 0.98;
      } else {
        hemiLight.intensity = 0.64;
        sunLight.intensity = 0.78;
        fillLight.intensity = 0.34;
        if (scene) scene.fog = new THREE.FogExp2(0xf8fafc, 0.006);
        if (renderer) renderer.toneMappingExposure = 1.02;
      }
    }

    function createSkyDomeAndEnvMap() {
      const skyGeo = new THREE.SphereGeometry(180, 40, 32);
      skyShaderUniforms = {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0.45, 0.62, 0.42).normalize() },
        uTopColor: { value: new THREE.Color(0x0369a1) },
        uMidColor: { value: new THREE.Color(0x38bdf8) },
        uHorizonColor: { value: new THREE.Color(0xfef3c7) },
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
            float halo = pow(sunAmt, 12.0) * 0.14 + pow(sunAmt, 80.0) * 0.22;
            float disc = smoothstep(0.9988, 0.9997, sunAmt) * 0.45;
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
      if (renderer && renderer.capabilities) {
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      }
      TEXTURE_CACHE[key] = tex;
      return tex;
    }

    function getProceduralPBRMaterial(type, baseHex = 0xffffff, roughness = 0.5, metalness = 0.05, repeat = 2) {
      const cacheKey = `pbr2_${type}_${baseHex}_${roughness}_${metalness}_${repeat}`;
      if (PBR_MAT_CACHE[cacheKey]) return PBR_MAT_CACHE[cacheKey];

      const colorObj = new THREE.Color(baseHex);
      const r = Math.round(colorObj.r * 255);
      const g = Math.round(colorObj.g * 255);
      const b = Math.round(colorObj.b * 255);

      const diffTex = makeCanvasTexture(`diff_${cacheKey}`, 512, 512, (ctx, w, h) => {
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(0, 0, w, h);
        if (type === 'wood') {
          for (let y = 0; y < h; y += 4) {
            const wave = Math.sin(y * 0.06) * 0.08;
            ctx.fillStyle = y % 8 === 0 ? `rgba(0,0,0,${0.12 + wave * 0.3})` : 'rgba(255,255,255,0.06)';
            ctx.fillRect(0, y, w, 2);
          }
          ctx.strokeStyle = 'rgba(28,12,2,0.35)';
          ctx.lineWidth = 3;
          for (let p = 0; p < w; p += 128) {
            ctx.beginPath();
            ctx.moveTo(p, 0);
            ctx.lineTo(p, h);
            ctx.stroke();
          }
        } else if (type === 'tile' || type === 'stone') {
          for (let i = 0; i < 650; i++) {
            ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.06)';
            ctx.fillRect(Math.random() * w, Math.random() * h, 6, 6);
          }
          ctx.strokeStyle = 'rgba(15,23,42,0.22)';
          ctx.lineWidth = 4;
          const step = w / 2;
          for (let gx = 0; gx < w; gx += step) {
            for (let gy = 0; gy < h; gy += step) {
              ctx.strokeRect(gx + 2, gy + 2, step - 4, step - 4);
              ctx.strokeStyle = 'rgba(255,255,255,0.24)';
              ctx.lineWidth = 2;
              ctx.strokeRect(gx + 6, gy + 6, step - 12, step - 12);
              ctx.strokeStyle = 'rgba(15,23,42,0.22)';
              ctx.lineWidth = 4;
            }
          }
        } else if (type === 'roof') {
          for (let y = 0; y < h; y += 32) {
            const grad = ctx.createLinearGradient(0, y, 0, y + 32);
            grad.addColorStop(0, 'rgba(255,255,255,0.14)');
            grad.addColorStop(1, 'rgba(0,0,0,0.24)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, y, w, 32);
            ctx.strokeStyle = 'rgba(0,0,0,0.32)';
            ctx.lineWidth = 3;
            for (let x = 0; x < w; x += 42) {
              ctx.beginPath();
              ctx.arc(x + 21, y + 6, 21, 0, Math.PI);
              ctx.stroke();
            }
          }
        } else if (type === 'brick') {
          ctx.strokeStyle = 'rgba(248,250,252,0.36)';
          ctx.lineWidth = 3;
          for (let y = 0; y < h; y += 32) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
            const offset = (y / 32) % 2 === 0 ? 0 : 42;
            for (let x = offset; x < w; x += 84) {
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(x, y + 32);
              ctx.stroke();
            }
          }
        } else if (type === 'grass') {
          for (let i = 0; i < 1400; i++) {
            ctx.fillStyle = i % 3 === 0 ? 'rgba(254,240,138,0.12)' : i % 2 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(6,78,59,0.16)';
            ctx.fillRect(Math.random() * w, Math.random() * h, 2, 7);
          }
        }
      });

      const roughTex = makeCanvasTexture(`rough_${cacheKey}`, 256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#b8b8b8';
        ctx.fillRect(0, 0, w, h);
        if (type === 'tile' || type === 'stone') {
          ctx.fillStyle = '#686868';
          ctx.fillRect(4, 4, w / 2 - 8, h / 2 - 8);
          ctx.fillRect(w / 2 + 4, 4, w / 2 - 8, h / 2 - 8);
          ctx.fillRect(4, h / 2 + 4, w / 2 - 8, h / 2 - 8);
          ctx.fillRect(w / 2 + 4, h / 2 + 4, w / 2 - 8, h / 2 - 8);
        } else if (type === 'wood') {
          for (let y = 0; y < h; y += 6) {
            ctx.fillStyle = y % 12 === 0 ? '#858585' : '#c4c4c4';
            ctx.fillRect(0, y, w, 3);
          }
        }
      });

      [diffTex, roughTex].forEach((t) => {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repeat, repeat);
      });

      const mat = new THREE.MeshStandardMaterial({
        map: diffTex,
        bumpMap: diffTex,
        bumpScale: 0.026,
        roughnessMap: roughTex,
        roughness,
        metalness
      });
      PBR_MAT_CACHE[cacheKey] = mat;
      return mat;
    }

    function createSignBoard(text, bg = '#7f1d1d', border = '#facc15', textColor = '#fef08a', width = 4, height = 0.8, isVertical = false) {
      const aspect = Math.max(0.15, width / Math.max(0.15, height));
      const cw = isVertical ? 256 : Math.min(1024, Math.max(512, Math.round(256 * aspect)));
      const ch = isVertical ? 1024 : 256;
      const cacheKey = `sign_${text}_${bg}_${border}_${textColor}_${cw}x${ch}_${isVertical}`;
      const tex = makeCanvasTexture(cacheKey, cw, ch, (ctx, w, h) => {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = border;
        ctx.lineWidth = isVertical ? 14 : 16;
        ctx.strokeRect(10, 10, w - 20, h - 20);
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 3;
        ctx.strokeRect(20, 20, w - 40, h - 40);

        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (isVertical) {
          const words = String(text).split(/\s+/).filter(Boolean);
          const stepY = (h - 120) / Math.max(1, words.length);
          const fSize = Math.min(56, Math.floor(stepY * 0.65));
          ctx.font = `800 ${fSize}px Inter, sans-serif`;
          words.forEach((word, idx) => {
            ctx.fillText(word, w / 2, 70 + stepY * (idx + 0.5), w - 44);
          });
        } else {
          let fontSize = 68;
          ctx.font = `800 ${fontSize}px Inter, sans-serif`;
          while (ctx.measureText(text).width > w - 64 && fontSize > 22) {
            fontSize -= 2;
            ctx.font = `800 ${fontSize}px Inter, sans-serif`;
          }
          ctx.fillText(text, w / 2, h / 2 + 2, w - 56);
        }
      });

      const group = new THREE.Group();
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.08, height + 0.08, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.5 })
      );
      group.add(frame);

      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map: tex })
      );
      face.position.z = 0.045;
      group.add(face);
      return group;
    }

    function createArtCanvasDataURL(art) {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 420;
      const ctx = canvas.getContext('2d');

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
        group.add(bloom);

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

    function createStudentDeskAndChair(hasBooks = true, hasChair = true) {
      const group = new THREE.Group();
      const topWood = getProceduralPBRMaterial('wood', 0xd97706, 0.42, 0.05, 2);
      const darkWood = getProceduralPBRMaterial('wood', 0x92400e, 0.48, 0.05, 2);
      const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.72, roughness: 0.3 });

      const deskTop = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.055, 0.62), topWood);
      deskTop.position.set(0, 0.74, 0);
      deskTop.castShadow = true;
      deskTop.receiveShadow = true;
      group.add(deskTop);

      const underShelf = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.035, 0.48), darkWood);
      underShelf.position.set(0, 0.58, 0);
      group.add(underShelf);

      const frontModesty = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.34, 0.035), darkWood);
      frontModesty.position.set(0, 0.54, -0.26);
      group.add(frontModesty);

      [[-0.7, -0.25], [0.7, -0.25], [-0.7, 0.25], [0.7, 0.25]].forEach(([lx, lz]) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.73, 0.045), steelMat);
        leg.position.set(lx, 0.365, lz);
        group.add(leg);
      });

      if (hasBooks) {
        const b1 = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.035, 0.21),
          new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.45 })
        );
        b1.position.set(-0.36, 0.785, 0.04);
        b1.rotation.y = 0.14;
        group.add(b1);

        const b2 = new THREE.Mesh(
          new THREE.BoxGeometry(0.26, 0.03, 0.19),
          new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.45 })
        );
        b2.position.set(0.32, 0.782, 0.02);
        b2.rotation.y = -0.18;
        group.add(b2);
      }

      if (hasChair) {
        [-0.38, 0.38].forEach((cx) => {
          const chair = new THREE.Group();
          chair.position.set(cx, 0, 0.46);
          const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.4), topWood);
          seat.position.y = 0.44;
          seat.castShadow = true;
          chair.add(seat);

          const backRest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.035), topWood);
          backRest.position.set(0, 0.74, 0.18);
          chair.add(backRest);

          [[-0.18, -0.16], [0.18, -0.16]].forEach(([lx, lz]) => {
            const fLeg = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.44, 0.035), steelMat);
            fLeg.position.set(lx, 0.22, lz);
            chair.add(fLeg);
          });
          [-0.18, 0.18].forEach((lx) => {
            const bPost = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.84, 0.035), steelMat);
            bPost.position.set(lx, 0.42, 0.18);
            chair.add(bPost);
          });
          group.add(chair);
        });
      }
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
        emissive: 0xfef9c3,
        emissiveIntensity: 0.45,
        roughness: 0.08,
        transparent: true,
        opacity: 0.85
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
      clockMesh.position.set(0, 0.56, 0);
      group.add(clockMesh);

      const slogan = createSignBoard(sloganText, bgHex, '#facc15', '#fef08a', 4.6, 0.42);
      slogan.position.set(0, 0.05, 0);
      group.add(slogan);

      return group;
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
        isSeated = false
      } = opts;

      const root = new THREE.Group();
      root.add(createContactShadow(0.32, 0.32, 0.34));
      const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.44, metalness: 0.03 });
      const shirtMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.48, metalness: 0.04 });
      const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.62 });
      const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.58, metalness: 0.08 });
      const shoeMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.15 });
      const soleMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45 });

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
      torso.scale.set(1.08, 1, 0.82);
      torso.position.y = hipY + 0.3;
      torso.castShadow = true;
      root.add(torso);

      const chestCap = new THREE.Mesh(new THREE.SphereGeometry(0.165, 18, 12), shirtMat);
      chestCap.scale.set(1.12, 0.42, 0.82);
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

      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.11, 16), skinMat);
      neck.position.y = hipY + 0.56;
      root.add(neck);

      const headGroup = new THREE.Group();
      headGroup.position.y = hipY + 0.725;
      root.add(headGroup);

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.152, 24, 24), skinMat);
      head.scale.set(0.93, 1.06, 0.96);
      head.castShadow = true;
      headGroup.add(head);

      [-0.05, 0.05].forEach((ex) => {
        const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfafafa }));
        eyeWhite.scale.set(1.15, 0.67, 0.65);
        eyeWhite.position.set(ex, 0.018, 0.14);
        headGroup.add(eyeWhite);

        const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 10, 10), new THREE.MeshBasicMaterial({ color: 0x1e1b18 }));
        iris.position.set(ex, 0.018, 0.153);
        headGroup.add(iris);

        const catchlight = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        catchlight.position.set(ex + 0.005, 0.023, 0.16);
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
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.022,12,10),skinMat);
      nose.scale.set(0.56,0.7,1.05);
      nose.position.set(0,-0.012,0.152);
      headGroup.add(nose);
      const smile = new THREE.Mesh(
        new THREE.TorusGeometry(0.026, 0.0044, 8, 16, Math.PI),
        new THREE.MeshBasicMaterial({ color: 0xbe123c })
      );
      smile.rotation.x = Math.PI;
      smile.position.set(0, -0.042, 0.142);
      headGroup.add(smile);

      const hairCap = new THREE.Mesh(
        new THREE.SphereGeometry(0.162, 20, 20, 0, Math.PI * 2, 0, Math.PI * 0.64),
        hairMat
      );
      hairCap.position.set(0, 0.016, -0.006);
      headGroup.add(hairCap);

      if (gender === 'female') {
        const backHair = new THREE.Mesh(new THREE.CylinderGeometry(0.142, 0.165, 0.32, 16), hairMat);
        backHair.position.set(0, -0.08, -0.055);
        headGroup.add(backHair);

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

        const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.042, 0.22, 12), shirtMat);
        upperArm.position.y = -0.11;
        shoulderPivot.add(upperArm);

        const lowerPivot = new THREE.Group();
        lowerPivot.position.y = -0.22;
        shoulderPivot.add(lowerPivot);

        const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.033, 0.21, 12), skinMat);
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
        const hipPivot = new THREE.Group();
        hipPivot.position.set(side * 0.084, hipY - 0.04, 0);

        const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.054, 0.36, 14), pantsMat);
        thigh.position.y = -0.18;
        thigh.castShadow = true;
        hipPivot.add(thigh);

        const lowerPivot = new THREE.Group();
        lowerPivot.position.y = -0.36;
        hipPivot.add(lowerPivot);

        const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.051, 0.042, 0.36, 14), pantsMat);
        shin.position.y = -0.18;
        shin.castShadow = true;
        lowerPivot.add(shin);

        const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.106, 0.072, 0.215), shoeMat);
        shoe.position.set(0, -0.37, 0.042);
        lowerPivot.add(shoe);

        const sole = new THREE.Mesh(new THREE.BoxGeometry(0.112, 0.022, 0.222), soleMat);
        sole.position.set(0, -0.405, 0.045);
        lowerPivot.add(sole);

        if (isSeated) {
          hipPivot.rotation.x = Math.PI / 2;
          lowerPivot.rotation.x = -Math.PI / 2;
        }

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

      root.userData = { leftLeg, rightLeg, leftArm, rightArm, headGroup, bouquetMesh };
      return root;
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
        new THREE.MeshStandardMaterial({ color: 0xfef9c3, emissive: 0xfef08a, emissiveIntensity: 0.35 })
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

      const rider = createRealisticHuman({
        gender: 'male',
        role: 'student',
        shirtColor: 0xffffff,
        pantsColor: 0x1e293b,
        isSeated: true
      });
      rider.position.set(0, 0.35, 0.06);
      rider.rotation.y = Math.PI;
      rider.userData.leftArm.rotation.x = -0.95;
      rider.userData.rightArm.rotation.x = -0.95;
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
    function createFloatingLabel(obj3D, htmlText, yOffset = 2.15) {
      const layer = document.getElementById('floating-labels-layer');
      if (!layer) return null;
      const el = document.createElement('div');
      el.className = 'floating-label glass-panel rounded-full px-2.5 py-1 text-[11px] font-bold text-white border border-white/20';
      el.innerHTML = htmlText;
      layer.appendChild(el);
      const item = { obj3D, el, yOffset };
      floatingLabelsData.push(item);
      return item;
    }

    function clearFloatingLabels() {
      const layer = document.getElementById('floating-labels-layer');
      if (layer) layer.innerHTML = '';
      floatingLabelsData = [];
    }

    function updateFloatingLabels() {
      if (!camera) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      const v = new THREE.Vector3();
      floatingLabelsData.forEach((item) => {
        if (!item.obj3D || !item.obj3D.parent) {
          item.el.style.opacity = '0';
          return;
        }
        let visibleInTree = true;
        let p = item.obj3D;
        while (p) {
          if (p.visible === false) {
            visibleInTree = false;
            break;
          }
          p = p.parent;
        }
        if (!visibleInTree) {
          item.el.style.opacity = '0';
          return;
        }
        item.obj3D.getWorldPosition(v);
        v.y += item.yOffset;
        v.project(camera);
        if (v.z > 1 || v.z < -1) {
          item.el.style.opacity = '0';
          return;
        }
        const sx = (v.x * 0.5 + 0.5) * width;
        const sy = (-v.y * 0.5 + 0.5) * height;
        item.el.style.left = `${sx}px`;
        item.el.style.top = `${sy}px`;
        item.el.style.opacity = '1';
      });
    }

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
        emissiveIntensity: 0.22,
        roughness: 0.06,
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

      const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.24, 3.1, 2.6), frameMat);
      doorFrame.position.set(frontFaceX, 2.05, 0);
      bGroup.add(doorFrame);

      const leftDoorPivot = new THREE.Group();
      leftDoorPivot.position.set(frontFaceX, 0.5, -1.18);
      const lGlass = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.9, 1.15), glassMat);
      lGlass.position.set(0, 1.45, 0.575);
      lGlass.userData = { interactiveType: doorType };
      leftDoorPivot.add(lGlass);
      bGroup.add(leftDoorPivot);

      const rightDoorPivot = new THREE.Group();
      rightDoorPivot.position.set(frontFaceX, 0.5, 1.18);
      const rGlass = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.9, 1.15), glassMat);
      rGlass.position.set(0, 1.45, -0.575);
      rGlass.userData = { interactiveType: doorType };
      rightDoorPivot.add(rGlass);
      bGroup.add(rightDoorPivot);

      bGroup.userData.entranceDoors = { left: leftDoorPivot, right: rightDoorPivot, outDir };
      return bGroup;
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
        emissiveIntensity: 0.45,
        roughness: 0.2
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
          new THREE.MeshStandardMaterial({ color: 0xdc2626, emissive: 0xf59e0b, emissiveIntensity: 0.45 })
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
      createFloatingLabel(teacherBuilding, '💙 Tri Ân Thầy Cô Giáo (Tòa Xanh)', 13.8);

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
      createFloatingLabel(femaleBuilding, '💖 Sự Kiện 20-11 (Tòa Hồng)', 13.8);

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

      const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
      [[-32, 36, -45], [18, 42, -55], [44, 34, -38], [-12, 39, -62]].forEach(([cx, cy, cz]) => {
        const cloud = new THREE.Group();
        cloud.position.set(cx, cy, cz);
        [0, 2.4, -2.2].forEach((ox, idx) => {
          const puff = new THREE.Mesh(new THREE.SphereGeometry(idx === 0 ? 3.2 : 2.3, 12, 12), cloudMat);
          puff.scale.set(1.4, 0.75, 1.0);
          puff.position.set(ox, idx === 0 ? 0.3 : 0, 0);
          cloud.add(puff);
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

      campusHero = createRealisticHuman({ gender: 'male', role: 'student', hasBouquet: true });
      campusHero.position.set(0.85, 0.14, 17.6);
      campusHero.rotation.y = Math.PI;
      campusGroup.add(campusHero);

      campusGroup.traverse((o) => {
        if (o.isMesh && o.userData && o.userData.interactiveType) interactiveList.push(o);
      });
    }

    // =========================================================================
    // 6. INTERIOR SHARED HELPERS (DOORS, 2-FLIGHT STAIRS, HALLWAY & ROOM SHELLS)
    // =========================================================================
    function createModernDoubleDoor(x, z, doorType, labelText) {
      const group = new THREE.Group();
      group.position.set(x, 0, z);

      const frameMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.26, metalness: 0.82 });
      const leafMat = getProceduralPBRMaterial('wood', 0xf1f5f9, 0.32, 0.06, 1);
      const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.45, roughness: 0.06, metalness: 0.12 });
      const steelMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.15 });

      [-1.12, 1.12].forEach((jx) => {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.95, 0.26), frameMat);
        jamb.position.set(jx, 1.475, 0);
        group.add(jamb);
      });

      const midTransom = new THREE.Mesh(new THREE.BoxGeometry(2.36, 0.12, 0.26), frameMat);
      midTransom.position.set(0, 2.44, 0);
      group.add(midTransom);

      const transomGlass = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.42, 0.06), glassMat);
      transomGlass.position.set(0, 2.68, 0);
      group.add(transomGlass);

      const topHeader = new THREE.Mesh(new THREE.BoxGeometry(2.36, 0.12, 0.26), frameMat);
      topHeader.position.set(0, 2.92, 0);
      group.add(topHeader);

      const sign = createSignBoard(labelText, '#0f172a', '#f59e0b', '#fef3c7', 2.05, 0.38);
      sign.position.set(0, 3.22, 0.08);
      group.add(sign);

      const leftPivot = new THREE.Group();
      leftPivot.position.set(-1.05, 0, 0);
      const lPanel = new THREE.Mesh(new THREE.BoxGeometry(1.03, 2.38, 0.075), leafMat);
      lPanel.position.set(0.515, 1.19, 0);
      lPanel.userData = { interactiveType: doorType };
      leftPivot.add(lPanel);
      const lGlass = new THREE.Mesh(new THREE.BoxGeometry(0.44, 1.58, 0.095), glassMat);
      lGlass.position.set(0.56, 1.34, 0);
      leftPivot.add(lGlass);
      const lHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.48, 10), steelMat);
      lHandle.position.set(0.92, 1.15, 0.065);
      leftPivot.add(lHandle);
      group.add(leftPivot);

      const rightPivot = new THREE.Group();
      rightPivot.position.set(1.05, 0, 0);
      const rPanel = new THREE.Mesh(new THREE.BoxGeometry(1.03, 2.38, 0.075), leafMat);
      rPanel.position.set(-0.515, 1.19, 0);
      rPanel.userData = { interactiveType: doorType };
      rightPivot.add(rPanel);
      const rGlass = new THREE.Mesh(new THREE.BoxGeometry(0.44, 1.58, 0.095), glassMat);
      rGlass.position.set(-0.56, 1.34, 0);
      rightPivot.add(rGlass);
      const rHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.48, 10), steelMat);
      rHandle.position.set(-0.92, 1.15, 0.065);
      rightPivot.add(rHandle);
      group.add(rightPivot);

      return { group, pivots: { left: leftPivot, right: rightPivot } };
    }

    function createCenterTwoFlightStaircase(group, upType, downType) {
      const stairGroup = new THREE.Group();
      stairGroup.position.set(0, 0, -3.55);

      const riserMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45 });
      const graniteMat = getProceduralPBRMaterial('tile', 0x334155, 0.28, 0.15, 1);
      const nosingGoldMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.75, roughness: 0.25 });
      const stringerMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 });
      const woodRailMat = getProceduralPBRMaterial('wood', 0x78350f, 0.35, 0.1, 2);
      const steelMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.88, roughness: 0.18 });
      const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.36, roughness: 0.08 });
      const alcoveSideMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.62 });

      [-2.15, 2.15].forEach((ax) => {
        const sideW = new THREE.Mesh(new THREE.BoxGeometry(0.24, 4.0, 3.3), alcoveSideMat);
        sideW.position.set(ax, 2.0, -1.6);
        stairGroup.add(sideW);
      });
      const backStairWall = new THREE.Mesh(new THREE.BoxGeometry(4.5, 4.0, 0.25), alcoveSideMat);
      backStairWall.position.set(0, 2.0, -3.25);
      stairGroup.add(backStairWall);

      const winFrame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.65, 0.16), steelMat);
      winFrame.position.set(0, 2.75, -3.12);
      stairGroup.add(winFrame);
      const winGlass = new THREE.Mesh(
        new THREE.BoxGeometry(2.0, 1.45, 0.08),
        new THREE.MeshBasicMaterial({ color: 0xfef9c3 })
      );
      winGlass.position.set(0, 2.75, -3.1);
      stairGroup.add(winGlass);

      const numSteps1 = 8;
      const stepH1 = 1.90 / numSteps1;
      const stepD1 = 2.10 / numSteps1;
      for (let i = 0; i < numSteps1; i++) {
        const sy = (i + 1) * stepH1;
        const sz = -i * stepD1;
        const riser = new THREE.Mesh(new THREE.BoxGeometry(1.72, stepH1 + 0.14, stepD1 + 0.02), riserMat);
        riser.position.set(1.02, sy - (stepH1 + 0.14) / 2, sz - stepD1 / 2);
        if (upType) riser.userData = { interactiveType: upType };
        stairGroup.add(riser);

        const tread = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.045, stepD1 + 0.04), graniteMat);
        tread.position.set(1.02, sy, sz - stepD1 / 2 + 0.01);
        if (upType) tread.userData = { interactiveType: upType };
        stairGroup.add(tread);

        const nose = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.02, 0.025), nosingGoldMat);
        nose.position.set(1.02, sy + 0.015, sz + 0.025);
        stairGroup.add(nose);
      }

      const f1Len = Math.hypot(2.10, 1.90);
      const f1Angle = Math.atan2(1.90, 2.10);
      [0.18, 1.88].forEach((sx) => {
        const stringer = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, f1Len + 0.2), stringerMat);
        stringer.rotation.x = f1Angle;
        stringer.position.set(sx, 0.85, -1.05);
        stairGroup.add(stringer);
      });

      const rail1Glass = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.78, f1Len), glassMat);
      rail1Glass.rotation.x = f1Angle;
      rail1Glass.position.set(0.18, 1.42, -1.05);
      stairGroup.add(rail1Glass);

      const rail1Wood = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, f1Len + 0.15), woodRailMat);
      rail1Wood.rotation.x = f1Angle;
      rail1Wood.position.set(0.18, 1.84, -1.05);
      stairGroup.add(rail1Wood);

      const landing = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.26, 1.05), stringerMat);
      landing.position.set(0, 1.77, -2.62);
      if (upType) landing.userData = { interactiveType: upType };
      stairGroup.add(landing);

      const landingGranite = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.04, 1.05), graniteMat);
      landingGranite.position.set(0, 1.91, -2.62);
      if (upType) landingGranite.userData = { interactiveType: upType };
      stairGroup.add(landingGranite);

      const numSteps2 = 8;
      const stepH2 = 1.90 / numSteps2;
      const stepD2 = 2.10 / numSteps2;
      for (let i = 0; i < numSteps2; i++) {
        const sy = 1.90 + (i + 1) * stepH2;
        const sz = -2.10 + i * stepD2;
        const riser = new THREE.Mesh(new THREE.BoxGeometry(1.72, stepH2 + 0.16, stepD2 + 0.02), riserMat);
        riser.position.set(-1.02, sy - (stepH2 + 0.16) / 2, sz + stepD2 / 2);
        if (upType) riser.userData = { interactiveType: upType };
        stairGroup.add(riser);

        const tread = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.045, stepD2 + 0.04), graniteMat);
        tread.position.set(-1.02, sy, sz + stepD2 / 2 - 0.01);
        if (upType) tread.userData = { interactiveType: upType };
        stairGroup.add(tread);

        const nose = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.02, 0.025), nosingGoldMat);
        nose.position.set(-1.02, sy + 0.015, sz - 0.025);
        stairGroup.add(nose);
      }

      [-1.88, -0.18].forEach((sx) => {
        const stringer = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, f1Len + 0.2), stringerMat);
        stringer.rotation.x = -f1Angle;
        stringer.position.set(sx, 2.75, -1.05);
        stairGroup.add(stringer);
      });

      const rail2Glass = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.78, f1Len), glassMat);
      rail2Glass.rotation.x = -f1Angle;
      rail2Glass.position.set(-0.18, 3.32, -1.05);
      stairGroup.add(rail2Glass);

      const rail2Wood = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, f1Len + 0.15), woodRailMat);
      rail2Wood.rotation.x = -f1Angle;
      rail2Wood.position.set(-0.18, 3.74, -1.05);
      stairGroup.add(rail2Wood);

      [[0.18, 1.35, 0], [0.18, 2.35, -2.08], [-0.18, 2.35, -2.08], [-0.18, 4.2, 0]].forEach(([px, py, pz]) => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.92, 10), steelMat);
        post.position.set(px, py, pz);
        stairGroup.add(post);
      });

      if (downType) {
        const downMat = new THREE.Mesh(
          new THREE.BoxGeometry(2.6, 0.04, 0.95),
          new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.45 })
        );
        downMat.position.set(0, 0.02, 0.65);
        downMat.userData = { interactiveType: downType };
        stairGroup.add(downMat);
      }

      group.add(stairGroup);
    }

    function buildHallwayCorridorShell(targetGroup, floorColor = 0xe2e8f0) {
      const theme = getActiveBuildingTheme();
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(26, 0.2, 7.2),
        getProceduralPBRMaterial('tile', floorColor, 0.34, 0.06, 8)
      );
      floor.position.set(0, -0.1, 0.2);
      floor.receiveShadow = true;
      targetGroup.add(floor);

      const ceil = new THREE.Mesh(
        new THREE.BoxGeometry(26, 0.2, 7.2),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 })
      );
      ceil.position.set(0, 3.9, 0.2);
      targetGroup.add(ceil);

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

      const wallMat = new THREE.MeshStandardMaterial({ color: theme.wallAccentHex, roughness: 0.58 });
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
      portalWall(-13,13,-3.55,[-9.2,-4.6,0,6.8]);
      portalWall(-13,13,3.8,[0]);
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
      [-11.4, -2.5, 2.5, 11.4].forEach((px) => {
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

      const wallMat = new THREE.MeshStandardMaterial({ color: theme.wallAccentHex, roughness: 0.58 });
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
    }

    // =========================================================================
    // 7. FLOOR 1: HALLWAY 1, ROOM 101, ROOM 102, ROOM 103
    // =========================================================================
    function buildHallway1() {
      const theme = getActiveBuildingTheme();
      while (hallwayGroup.children.length > 0) hallwayGroup.remove(hallwayGroup.children[0]);

      buildHallwayCorridorShell(hallwayGroup, 0xe2e8f0);

      const banner = createSignBoard(`${theme.buildingName.toUpperCase()} • TẦNG 1`, theme.signBg, theme.signBorder, '#ffffff', 5.8, 0.56);
      banner.position.set(0, 3.45, -3.45);
      hallwayGroup.add(banner);

      createCenterTwoFlightStaircase(hallwayGroup, 'stairs_up_2', 'exit_to_campus');

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

      roomHero = createRealisticHuman({ gender: 'male', role: 'student', hasBouquet: true });
      roomHero.position.set(lastExitedDoorX, 0, 1.2);
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
      podium.receiveShadow = true;
      targetGroup.add(podium);

      const teacherDesk = new THREE.Mesh(
        new THREE.BoxGeometry(1.75, 0.78, 0.78),
        getProceduralPBRMaterial('wood', 0xb45309, 0.38)
      );
      teacherDesk.position.set(1.55, 0.55, -4.55);
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
      clockAndSlogan.position.set(0, 3.05, -5.84);
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
      board.position.set(0, 1.95, -5.82);
      board.userData = { interactiveType: 'chalkboard_wish' };
      classroomGroup.add(board);
      room101BoardMesh = board;
      if (room101SavedWishes.length > 0) {
        updateRoom101ChalkboardWish(room101SavedWishes[room101SavedWishes.length - 1]);
      }

      if (currentBuildingSide === 'female') {
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
          dGroup.position.set(dx, 0, dz);
          classroomGroup.add(dGroup);
        });

        // Central gift & floral arrangement table
        const centerTable = new THREE.Mesh(
          new THREE.BoxGeometry(1.8, 0.74, 1.0),
          getProceduralPBRMaterial('wood', 0xb45309, 0.4)
        );
        centerTable.position.set(0, 0.37, -0.2);
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
          st.position.set(stCfg.x, 0, stCfg.z);
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
              st.position.set(dx + seatOffX, 0, dz + 0.44);
              st.rotation.y = Math.PI;
              classroomGroup.add(st);
              room101SeatedStudents.push({ mesh: st, phase: colIdx + rowIdx + seatIdx });
            });
          });
        });
      }

      roomHero = createRealisticHuman({ gender: 'male', role: 'student', hasBouquet: currentBuildingSide === 'teacher' });
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

      const clockAndSlogan = createWallClockAndSlogan('TIẾT HỌC TRI ÂN CHÀO MỪNG 20/11', theme.signBg);
      clockAndSlogan.position.set(0, 3.18, -5.84);
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

      const slideTex = makeCanvasTexture('slide_page_0', 1024, 512, (ctx, w, h) => {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 12;
        ctx.strokeRect(12, 12, w - 24, h - 24);
        ctx.fillStyle = '#fde047';
        ctx.font = '800 38px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(SLIDE_PAGES[0].title, w / 2, 160);
        ctx.fillStyle = '#f8fafc';
        ctx.font = '500 26px Inter, sans-serif';
        ctx.fillText('Nhấn vào màn chiếu hoặc dùng nút bên dưới để chuyển slide 20/11', w / 2, 270);
      });

      room102SlideMesh = new THREE.Mesh(
        new THREE.BoxGeometry(5.0, 2.25, 0.1),
        new THREE.MeshBasicMaterial({ map: slideTex })
      );
      room102SlideMesh.position.set(0.45, 1.95, -5.8);
      room102SlideMesh.userData = { interactiveType: 'open_slide_modal' };
      classroomGroup.add(room102SlideMesh);

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
          deskAndChair.position.set(dx, 0, dz);
          classroomGroup.add(deskAndChair);
          registerCollider(dx,dz+0.22,1.75,1.28,0.18);
          if (rowIdx < 2) {
            const st = createRealisticHuman({
              gender: (colIdx + rowIdx) % 2 === 0 ? 'female' : 'male',
              role: 'student',
              isSeated: true
            });
            st.position.set(dx - 0.36, 0, dz + 0.44);
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
        room102Teacher.position.set(-2.3, 0.16, -4.4);
        classroomGroup.add(room102Teacher);
        activeIdleCharacters.push({ mesh: room102Teacher, phase: 0.6 });
      }

      roomHero = createRealisticHuman({ gender: 'male', role: 'student', hasBouquet: true });
      roomHero.position.set(0, 0, 4.4);
      roomHero.rotation.y = Math.PI;
      classroomGroup.add(roomHero);

      classroomGroup.traverse((o) => {
        if (o.isMesh && o.userData && o.userData.interactiveType) interactiveList.push(o);
      });
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

      // Decorative red carpet runner & velvet benches & plants
      const runner = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.02, 8.6),
        new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.72 })
      );
      runner.position.set(0, 0.01, -0.4);
      classroomGroup.add(runner);

      [[-5.8, -5.0], [5.8, -5.0], [-5.8, 4.8], [5.8, 4.8]].forEach(([px, pz]) => {
        const plant = createPottedIndoorPlant(1.05);
        plant.position.set(px, 0, pz);
        classroomGroup.add(plant);
      });

      [-2.2, 2.2].forEach((bx) => {
        const bench = createWoodenBench(2.0);
        bench.position.set(bx, 0, 1.8);
        classroomGroup.add(bench);
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
          new THREE.MeshBasicMaterial({ map: tex })
        );
        canvasPlane.position.z = 0.06;
        canvasPlane.userData = { interactiveType: 'view_artwork', artIndex: sp.idx };
        frame.add(canvasPlane);
        classroomGroup.add(frame);
      });

      const pedMat = getProceduralPBRMaterial('wood', 0x78350f, 0.4);
      const bookColors = [0xdc2626, 0x0284c7, 0x16a34a, 0xd97706, 0x7c3aed];
      for (let b = 0; b < 5; b++) {
        const px = -4.2 + b * 2.1;
        const ped = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.0, 0.8), pedMat);
        ped.position.set(px, 0.5, -1.6);
        ped.castShadow = true;
        classroomGroup.add(ped);
        registerCollider(px,-1.6,0.95,0.8,0.14);

        const book = new THREE.Mesh(
          new THREE.BoxGeometry(0.55, 0.08, 0.42),
          new THREE.MeshStandardMaterial({ color: bookColors[b], roughness: 0.35 })
        );
        book.position.set(px, 1.06, -1.6);
        book.rotation.x = 0.22;
        book.userData = { interactiveType: 'open_anthology', bookIndex: b };
        classroomGroup.add(book);
      }

      // 3 Gallery Visitors admiring paintings & anthologies
      [
        { x: -4.4, z: -2.8, rotY: -Math.PI / 2, gender: 'female', shirt: 0xffffff },
        { x: 4.4, z: 0.2, rotY: Math.PI / 2, gender: 'male', shirt: 0xffffff },
        { x: -1.8, z: -2.6, rotY: 0, gender: 'female', shirt: 0xfce7f3 }
      ].forEach((v, idx) => {
        const visitor = createRealisticHuman({ gender: v.gender, role: 'student', shirtColor: v.shirt });
        visitor.position.set(v.x, 0, v.z);
        visitor.rotation.y = v.rotY;
        classroomGroup.add(visitor);
        activeIdleCharacters.push({ mesh: visitor, phase: idx * 1.2 });
      });

      roomHero = createRealisticHuman({ gender: 'male', role: 'student', hasBouquet: true });
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

      buildHallwayCorridorShell(hallway2Group, 0xe2e8f0);

      const banner = createSignBoard(`${theme.buildingName.toUpperCase()} • TẦNG 2`, theme.signBg, theme.signBorder, '#ffffff', 5.8, 0.56);
      banner.position.set(0, 3.45, -3.45);
      hallway2Group.add(banner);

      createCenterTwoFlightStaircase(hallway2Group, 'stairs_up_3', 'stairs_down_1');

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

      roomHero = createRealisticHuman({ gender: 'male', role: 'student', hasBouquet: true });
      roomHero.position.set(lastExitedDoorX, 0, 1.2);
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

      roomHero = createRealisticHuman({ gender: 'male', role: 'student', hasBouquet: true });
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

      roomHero = createRealisticHuman({ gender: 'male', role: 'student', hasBouquet: true });
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

      buildHallwayCorridorShell(hallway3Group, 0xfef3c7);

      const banner = createSignBoard(`${theme.buildingName.toUpperCase()} • TẦNG 3`, theme.signBg, theme.signBorder, '#ffffff', 5.8, 0.56);
      banner.position.set(0, 3.45, -3.45);
      hallway3Group.add(banner);

      createCenterTwoFlightStaircase(hallway3Group, null, 'stairs_down_2');

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

      roomHero = createRealisticHuman({ gender: 'male', role: 'student', hasBouquet: true });
      roomHero.position.set(lastExitedDoorX, 0, 1.2);
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

      roomHero = createRealisticHuman({ gender: 'male', role: 'student', hasBouquet: currentBuildingSide === 'teacher' });
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

      roomHero = createRealisticHuman({ gender: 'male', role: 'student', hasBouquet: true });
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
          cameraState.overview.position.set(hall ? roomHero.position.x : 0, hall ? 2.8 : 2.7, hall ? 2.75 : 4.25);
          cameraState.overview.target.set(hall ? roomHero.position.x : 0, 1.4, hall ? -1.25 : -1.8);
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
      // This is a virtual scene cut: the avatar never jumps through opaque geometry on screen.
      sceneMode = mode;
      interiorColliders = [];
      heroVelocity.set(0, 0, 0);
      transitionLock = false;
      classroomWalkAnim = exitRoomWalkAnim = stairClimbAnim = null;
      room101GiftAnim = room301GiftAnim = null;
      giftBloom = null;
      setSceneCurtain(false);
      interactiveList = [];
      activeIdleCharacters = [];
      clearFloatingLabels();
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
        campusGroup.traverse((o) => {
          if (o.isMesh && o.userData && o.userData.interactiveType) interactiveList.push(o);
        });
        if (campusGroup.userData.teacherBuilding) {
          createFloatingLabel(campusGroup.userData.teacherBuilding, '💙 Tri Ân Thầy Cô Giáo (Tòa Xanh)', 13.8);
        }
        if (campusGroup.userData.femaleBuilding) {
          createFloatingLabel(campusGroup.userData.femaleBuilding, '💖 Sự Kiện 20-11 (Tòa Hồng)', 13.8);
        }
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
          { label: '📽️ Mở Slide Bài Giảng', onClick: () => openSlideModal(currentSlideIdx) },
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
      if (campusHero) {
        campusHero.position.set(0, 0.14, 15.5);
      }
      if (scooterRiderMesh) scooterRiderMesh.visible = false;
      campusEnterBuildingAnim = {
        progress: 0,
        startX: 0,
        startZ: 15.5,
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
      if (activeTransition()) return;
      lastExitedDoorX = 0;
      stairClimbAnim = {
        progress: 0,
        fromX: roomHero ? roomHero.position.x : 0,
        fromZ: roomHero ? roomHero.position.z : 0,
        fromY: roomHero ? roomHero.position.y : 0,
        targetHallwayMode,
        goingUp
      };
      playChime(goingUp ? 660 : 440, 0.18);
    }

    function startGiftCeremony(whichRoom) {
      if (activeTransition() || sceneMode !== whichRoom) return;
      const teacher = whichRoom === 'room101' ? room101Teacher : room301Teacher;
      if (!teacher || !roomHero) return;
      const studentFlowers = roomHero.userData.bouquetMesh;
      const teacherFlowers = teacher.userData.bouquetMesh;
      if (studentFlowers) studentFlowers.visible = true;
      if (teacherFlowers) teacherFlowers.visible = false;
      // Consistent choreography: approach -> stop -> offer -> receive -> bow.
      const gift = {
        progress: 0, delivered: false,
        startX: roomHero.position.x, startZ: roomHero.position.z,
        targetX: 0,
        targetZ: whichRoom === 'room101' ? -3.22 : -3.25,
        teacher, whichRoom
      };
      if (whichRoom === 'room101') room101GiftAnim = gift;
      else room301GiftAnim = gift;
      const receiver = currentBuildingSide === 'female' ? 'cô' : 'thầy';
      const line = `Em kính tặng ${receiver} bó hoa nhân ngày Nhà giáo Việt Nam. Em xin cảm ơn ${receiver} ạ!`;
      showSpeechCard('Học sinh • Lời tri ân',line);
      // Speak immediately from the real click, avoiding autoplay restrictions.
      speakVietnamese(line);
      playChime(650,0.16);
    }

    function triggerRoom101Gift() { startGiftCeremony('room101'); }
    function triggerRoom301Gift() { startGiftCeremony('room301'); }

    function updateGiftCeremony(g, dt, elapsed) {
      g.progress = Math.min(1, g.progress + dt / 7.0);
      const p = g.progress;
      const approach = easeInOut(Math.min(1,p/0.54));
      roomHero.position.x = THREE.MathUtils.lerp(g.startX,g.targetX,approach);
      roomHero.position.z = THREE.MathUtils.lerp(g.startZ,g.targetZ,approach);
      // Face teacher for the entire gift, without drifting into the teacher's body.
      roomHero.rotation.y = THREE.MathUtils.lerp(roomHero.rotation.y, Math.PI, Math.min(1,dt*6));
      const reach = smooth01((p-0.54)/0.22);
      const relax = 1 - smooth01((p-0.79)/0.15);
      const hand = reach * relax;
      if (p < 0.54) animateHumanWalk(roomHero,elapsed,8,dt);
      else animateHumanWalk(roomHero,elapsed,0,dt);
      if (roomHero.userData.rightArm) roomHero.userData.rightArm.rotation.x = -0.15 - hand*0.95;
      if (g.teacher.userData.rightArm) g.teacher.userData.rightArm.rotation.x = -0.15 - hand*1.02;
      if (roomHero.userData.leftArm) roomHero.userData.leftArm.rotation.x = -hand*0.28;
      if (g.teacher.userData.leftArm) g.teacher.userData.leftArm.rotation.x = -hand*0.18;
      if (!g.delivered && p >= 0.755) {
        g.delivered = true;
        if (roomHero.userData.bouquetMesh) roomHero.userData.bouquetMesh.visible = false;
        if (g.teacher.userData.bouquetMesh) g.teacher.userData.bouquetMesh.visible = true;
        playChime(880,0.22);
        giftBloom = { time: 0, origin: g.teacher.position.clone() };
        const answer = currentBuildingSide === 'female'
          ? 'Cô cảm ơn em. Cô chúc em luôn tự tin và học tập thật tốt nhé!'
          : 'Thầy cảm ơn em. Chúc em luôn chăm ngoan, học giỏi và vững bước trên hành trình phía trước!';
        showSpeechCard('Giáo viên • Lời đáp',answer);
        speakVietnamese(answer);
      }
      if (p > 0.81 && roomHero.userData.headGroup) {
        roomHero.userData.headGroup.rotation.x = smooth01((p-0.81)/0.07) * (1-smooth01((p-0.91)/0.06)) * 0.22;
      }
      if (p >= 1) {
        g.teacher.userData.rightArm.rotation.x = -0.22; // holds the gift close to torso
        roomHero.userData.rightArm.rotation.x = 0;
        roomHero.userData.leftArm.rotation.x = 0;
        roomHero.userData.headGroup.rotation.x = 0;
        if (g.whichRoom === 'room101') room101GiftAnim = null;
        else room301GiftAnim = null;
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

    function openSlideModal(idx) {
      currentSlideIdx = ((idx % SLIDE_PAGES.length) + SLIDE_PAGES.length) % SLIDE_PAGES.length;
      const slide = SLIDE_PAGES[currentSlideIdx];
      document.getElementById('slide-modal-title').textContent = slide.title;
      document.getElementById('slide-modal-body').textContent = slide.body;
      document.getElementById('slide-modal-counter').textContent = `${currentSlideIdx + 1} / ${SLIDE_PAGES.length}`;
      document.getElementById('slide-modal').classList.remove('hidden');

      if (room102SlideMesh) {
        const tex = makeCanvasTexture(`slide_page_${currentSlideIdx}`, 1024, 512, (ctx, w, h) => {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 12;
          ctx.strokeRect(12, 12, w - 24, h - 24);
          ctx.fillStyle = '#fde047';
          ctx.font = '800 34px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(slide.title, w / 2, 150, w - 80);
          ctx.fillStyle = '#f8fafc';
          ctx.font = '500 24px Inter, sans-serif';
          ctx.fillText(slide.body.slice(0, 62), w / 2, 250, w - 90);
          if (slide.body.length > 62) {
            ctx.fillText(slide.body.slice(62, 128), w / 2, 295, w - 90);
          }
        });
        room102SlideMesh.material.map = tex;
        room102SlideMesh.material.needsUpdate = true;
      }
    }

    function openArtworkViewer(idx) {
      const art = GALLERY_ARTWORKS[idx % GALLERY_ARTWORKS.length];
      document.getElementById('art-modal-title').textContent = art.title;
      document.getElementById('art-modal-desc').textContent = art.desc;
      document.getElementById('art-modal-img').src = createArtCanvasDataURL(art);
      document.getElementById('artwork-modal').classList.remove('hidden');
    }

    function openAnthologyModal(bookIdx = 0, pageIdx = 0) {
      currentAnthologyBookIdx = (bookIdx + ANTHOLOGY_BOOKS.length) % ANTHOLOGY_BOOKS.length;
      const book = ANTHOLOGY_BOOKS[currentAnthologyBookIdx];
      currentAnthologyPageIdx = (pageIdx + book.pages.length) % book.pages.length;
      const page = book.pages[currentAnthologyPageIdx];

      document.getElementById('anthology-chapter').textContent = book.name;
      document.getElementById('anthology-title').textContent = page.title;
      document.getElementById('anthology-body').textContent = page.body;
      document.getElementById('anthology-author').textContent = `— ${page.author}`;
      document.getElementById('anthology-counter').textContent = `${currentAnthologyPageIdx + 1} / ${book.pages.length}`;

      document.querySelectorAll('.anthology-tab').forEach((btn, i) => {
        if (i === currentAnthologyBookIdx) {
          btn.classList.add('bg-amber-500', 'text-slate-950');
          btn.classList.remove('bg-white/10');
        } else {
          btn.classList.remove('bg-amber-500', 'text-slate-950');
          btn.classList.add('bg-white/10');
        }
      });

      document.getElementById('anthology-modal').classList.remove('hidden');
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

        if (campusGateReplayAnim && campusScooterGroup) {
          campusGateReplayAnim.progress += dt * 0.35;
          const p = Math.min(1, campusGateReplayAnim.progress);
          campusScooterGroup.position.z = 32 - p * 14;
          scooterWheels.forEach((w) => {
            w.rotation.x -= dt * 11;
          });
          if (p >= 1) campusGateReplayAnim = null;
        }

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
            switchSceneMode('hallway');
          }
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
        a.progress=Math.min(1,a.progress+dt/2.15);
        const p=a.progress;
        if(roomHero){
          const approach=smooth01(Math.min(1,p/0.5));
          roomHero.position.x=THREE.MathUtils.lerp(a.fromX,0,approach);
          roomHero.position.z=THREE.MathUtils.lerp(a.fromZ,-2.25,approach);
          roomHero.position.y=a.fromY+(a.goingUp?1:-1)*2.35*smooth01((p-0.35)/0.65);
          roomHero.rotation.y=Math.PI;
          animateHumanWalk(roomHero,elapsed,9,dt);
        }
        if(p>0.76) setSceneCurtain(true);
        if(p>=1) switchSceneMode(a.targetHallwayMode);
      }
      if (room101GiftAnim && roomHero && room101Teacher) updateGiftCeremony(room101GiftAnim,dt,elapsed);
      if (room301GiftAnim && roomHero && room301Teacher) updateGiftCeremony(room301GiftAnim,dt,elapsed);
      if (giftBloom) {
        giftBloom.time += dt;
        if (giftBloom.time >= 0.7) giftBloom = null;
      }

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
        const canControl = !activeTransition() && !document.querySelector('.fixed.inset-0.z-50:not(.hidden)');
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
        const accel = 1-Math.exp(-dt * (length ? 11 : 13));
        heroVelocity.x=THREE.MathUtils.lerp(heroVelocity.x,desiredX*2.65,accel);
        heroVelocity.z=THREE.MathUtils.lerp(heroVelocity.z,desiredZ*2.65,accel);
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
        if(!activeTransition()) animateHumanWalk(roomHero,elapsed,speed>0.07?8:0,dt,speed/2.65);
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
          camera.position.y=THREE.MathUtils.clamp(camera.position.y,1.65,hall?3.55:3.4);
        } else if (SCENE_CAMERA_BOUNDS[sceneMode]) {
          const b=SCENE_CAMERA_BOUNDS[sceneMode];
          camera.position.x=THREE.MathUtils.clamp(camera.position.x,b.minX,b.maxX);
          camera.position.y=THREE.MathUtils.clamp(camera.position.y,b.minY,b.maxY);
          camera.position.z=THREE.MathUtils.clamp(camera.position.z,b.minZ,b.maxZ);
        }
        controls.update();
      }

      updateFloatingLabels();
      updatePOVViewmodel(elapsed);
      renderer.render(scene, camera);
    }

    function bindUIEvents() {
      const skipBtn = document.getElementById('btn-skip-intro');
      if (skipBtn) skipBtn.addEventListener('click', () => switchSceneMode('campus'));

      document.querySelectorAll('.cam-pill[data-cam]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const camType = btn.getAttribute('data-cam');
          if (sceneMode !== 'campus') switchSceneMode('campus');
          if (camType === 'gate') {
            camera.position.set(0, 5.2, 34);
            controls.target.set(0, 3.2, 24);
          } else {
            camera.position.set(0, 12.5, 33);
            controls.target.set(0, 2.5, 4);
          }
          playChime(560, 0.12);
        });
      });

      const enterTeacherBtn = document.getElementById('btn-enter-teacher-bldg');
      if (enterTeacherBtn) enterTeacherBtn.addEventListener('click', () => startEnterBuildingSequence('teacher'));

      const enterFemaleBtn = document.getElementById('btn-enter-female-bldg');
      if (enterFemaleBtn) enterFemaleBtn.addEventListener('click', () => startEnterBuildingSequence('female'));

      const replayGateBtn = document.getElementById('btn-replay-gate');
      if (replayGateBtn) {
        replayGateBtn.addEventListener('click', () => {
          if (sceneMode !== 'campus') switchSceneMode('campus');
          if (scooterRiderMesh) scooterRiderMesh.visible = true;
          campusGateReplayAnim = { progress: 0 };
          camera.position.set(4.5, 4.8, 32);
          controls.target.set(0, 2.2, 22);
          playChime(620, 0.16);
        });
      }

      window.addEventListener('keydown', (e) => {
        const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'') || document.activeElement?.isContentEditable;
        if(typing) return;
        if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
        keysPressed[e.code] = true;
      });
      window.addEventListener('keyup', e => { keysPressed[e.code]=false; });
      window.addEventListener('blur',()=>{Object.keys(keysPressed).forEach(k=>keysPressed[k]=false);isPointerDragging=false;});

      // 360-degree look-around when First-Person POV is active
      renderer.domElement.addEventListener('pointerdown', (e) => {
        isPointerDragging = true;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        if (isFirstPersonPOV) renderer.domElement.setPointerCapture?.(e.pointerId);
      });
      window.addEventListener('pointermove', (e) => {
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
      window.addEventListener('pointerup', () => {
        isPointerDragging = false;
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
        if(pov) { fpYaw=roomHero?.rotation.y ?? Math.PI; fpPitch=-0.04; }
        applyInteriorCameraView(true);
        playChime(pov?540:660,0.13);
      }
      const btnOverview=document.getElementById('btn-camera-overview');
      const btnDonor=document.getElementById('btn-camera-donor');
      if(btnOverview) btnOverview.addEventListener('click',()=>chooseCamera(false));
      if(btnDonor) btnDonor.addEventListener('click',()=>chooseCamera(true));
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
          if (renderer) {
            renderer.setPixelRatio(graphicsUltra ? Math.min(window.devicePixelRatio || 1, 2) : 1);
          }
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

      const closeSlide = document.getElementById('btn-close-slide');
      if (closeSlide) closeSlide.addEventListener('click', () => document.getElementById('slide-modal').classList.add('hidden'));
      const prevSlide = document.getElementById('btn-prev-slide');
      if (prevSlide) prevSlide.addEventListener('click', () => openSlideModal(currentSlideIdx - 1));
      const nextSlide = document.getElementById('btn-next-slide');
      if (nextSlide) nextSlide.addEventListener('click', () => openSlideModal(currentSlideIdx + 1));

      ['btn-close-art', 'btn-ok-art'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => document.getElementById('artwork-modal').classList.add('hidden'));
      });

      const closeAnth = document.getElementById('btn-close-anthology');
      if (closeAnth) closeAnth.addEventListener('click', () => document.getElementById('anthology-modal').classList.add('hidden'));
      document.querySelectorAll('.anthology-tab').forEach((tab) => {
        tab.addEventListener('click', () => openAnthologyModal(Number(tab.getAttribute('data-book') || 0), 0));
      });
      const prevAnth = document.getElementById('btn-prev-anthology');
      if (prevAnth) prevAnth.addEventListener('click', () => openAnthologyModal(currentAnthologyBookIdx, currentAnthologyPageIdx - 1));
      const nextAnth = document.getElementById('btn-next-anthology');
      if (nextAnth) nextAnth.addEventListener('click', () => openAnthologyModal(currentAnthologyBookIdx, currentAnthologyPageIdx + 1));

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
        else if (type === 'open_slide_modal') openSlideModal(currentSlideIdx);
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

      camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.15, 240);
      camera.position.set(0, 12.5, 34);

      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.domElement.setAttribute('aria-label','Thế giới 3D tương tác trường học 20 tháng 11');
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.04;
      container.appendChild(renderer.domElement);
      scene.add(camera);
      buildPOVViewmodel();

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
      sunLight.shadow.bias = -0.0004;
      sunLight.shadow.normalBias = 0.025;
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