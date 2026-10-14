// Game constants, round rules and the canvas.
const LW = 1280, LH = 720, ROUND_TIME = 30 /* TẠM để test, bản thật: 300 */, FISH_N = 100, TAU = Math.PI * 2;
const SLAP_R = 120, PLATE_HIT_R = 75, MAX_PLAYERS = 10; // slam reach on the ground for a tap; reach (before the round's plateHit) for knocking fish out of the plate
const CHARGE_MS = 1000, FAN_LIFT = 60; // hold to raise the fan (full height after CHARGE_MS), release to slam: the only way to move fish
const slamR = lv => SLAP_R * (1 + 0.8 * lv);   // slam reach grows with fan height (lv 0..1)
const ROUNDS = [null,
  { name: 'Dễ', rim: 0, rx: 72, ry: 45, move: false, cross: false, wind: false, foul: false, plateHit: 0.8,
    rules: ['Cá rơi vào đĩa là được tính điểm. Quạt cẩn thận không là kẹt, hay là bay mất cá của đồng đội nha.',
            'Gió của bạn không làm xê dịch con cá mà đồng đội đang quạt.'] },
  { name: 'Thường', rim: 10, rx: 60, ry: 38, move: false, cross: true, wind: false, foul: false, plateHit: 2,
    rules: ['Đĩa nhỏ hơn và có vành cao hơn: cá bay thấp đập vào thành đĩa sẽ bật ra, cá trượt sát đất thì chui xuống dưới mép đĩa và kẹt lại. Đập quạt phía sau cá cho cá bay lên mới lọt vào đĩa.',
            'Cá trong đĩa dễ bay ra hơn: đập quạt cách đĩa khá xa vẫn có thể hất mất cá, bị trừ lại điểm của con cá đó. Hết giờ, cá còn trong đĩa mới được tính.',
            'Quạt của bạn giờ thổi bay cả cá mà đồng đội đang quạt.'] },
  { name: 'Khó', rim: 10, rx: 50, ry: 32, move: true, cross: true, wind: true, foul: true, plateHit: 2,
    rules: ['Gồm tất cả luật của vòng Thường.',
            'Đĩa nhỏ hơn nữa và trôi qua trôi lại.',
            'Gió ngang đổi hướng liên tục, thổi lệch cá đang bay. Ô "Gió" trên màn hình cho biết chiều và độ mạnh.',
            'Đập quạt trúng cá: cả đội bị trừ 1 giây.'] }
];
const PLATE = { x: LW / 2, y: 150, rx: 72, ry: 45 };
const COLORS = ['#c8161d', '#1f5fbf', '#1d8a4a', '#e08a00', '#7b3fb5', '#0c8f8f', '#d63384', '#5c4033', '#2b2823', '#6f8f00']; // one per player slot (MAX_PLAYERS)
const PREFIX = 'quatca-vao-dia-2026-';
const SLOT_PREFIX = PREFIX + 'cho-phong-'; // a quản trò's tab holds one of MAX_ROOMS fixed ids while their room is open
const MAX_ROOMS = 3, MAX_TEAMS = 6;        // rooms open at once; teams in one room
// What the host can set for each round (defaults here), and the choices offered
const DEFAULT_ROUND = { fish: FISH_N, time: ROUND_TIME, plate: 1 };
const FISH_MIN = 10, FISH_MAX = 200, FISH_STEP = 10; // fish count is a multiple of 10: one tenth of the fish for each point value 1..10
const TIME_OPTS = [30, 60, 90, 120, 180, 240, 300, 420, 600]; // seconds
const PLATE_OPTS = [[0.6, 'Rất nhỏ'], [0.8, 'Nhỏ'], [1, 'Vừa'], [1.3, 'To'], [1.6, 'Rất to']]; // × the round's own plate size
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
