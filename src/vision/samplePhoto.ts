type SampleCard = {
  x: number;
  y: number;
  name: string;
  height?: number;
  die?: number;
  fanCount?: number;
};

const SAMPLE_CARDS: SampleCard[] = [
  { x: 90, y: 70, name: "Lightning Bolt" },
  { x: 90, y: 145, name: "Frost Lynx" },
  { x: 90, y: 220, name: "Counterspell" },
  { x: 90, y: 295, name: "Preordain" },
  { x: 90, y: 370, name: "Brainstorm" },
  { x: 90, y: 445, name: "Island", height: 520, fanCount: 6 },
  { x: 390, y: 90, name: "Lightning Strike" },
  { x: 390, y: 165, name: "Shock" },
  { x: 390, y: 240, name: "Play with Fire" },
  { x: 390, y: 315, name: "Monastery Swiftspear" },
  { x: 390, y: 390, name: "Mountain", height: 520, die: 5 },
  { x: 690, y: 80, name: "Scorching Dragonfire" },
  { x: 690, y: 155, name: "Consider" },
  { x: 690, y: 230, name: "Opt" },
  { x: 690, y: 305, name: "Spell Pierce" },
  { x: 690, y: 380, name: "Steam Vents", height: 530 },
  { x: 990, y: 110, name: "Expressive Iteration" },
  { x: 990, y: 185, name: "Ledger Shredder" },
  { x: 990, y: 260, name: "Dragon's Rage Channeler" },
  { x: 990, y: 335, name: "Spirebluff Canal", height: 560 },
];

export const SAMPLE_CARD_NAMES = SAMPLE_CARDS.map((card) => card.name);

export async function loadSamplePhoto(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 2100;
  canvas.height = 1470;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw the sample photo.");
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = "#1b4332";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#244c3a";
  roundRect(ctx, 60, 54, 1980, 1362, 42);
  ctx.fill();

  const scale = 1.5;
  for (const card of SAMPLE_CARDS) {
    drawCard(ctx, {
      ...card,
      x: Math.round(card.x * scale),
      y: Math.round(card.y * scale),
      height: card.height ? Math.round(card.height * scale) : undefined,
    });
  }

  const png = await canvasToBlob(canvas);
  return new File([png], "sample-deck.png", { type: "image/png" });
}

function drawCard(ctx: CanvasRenderingContext2D, card: SampleCard): void {
  const width = 375;
  const height = card.height ?? 525;
  const extras = Math.max(0, (card.fanCount ?? 1) - 1);
  const sliver = 24;
  for (let i = extras; i >= 1; i -= 1) {
    drawCardBody(ctx, card.x - i * sliver, card.y, width, height, "#cbb89a");
  }
  drawCardBody(ctx, card.x, card.y, width, height, "#d7c7a8");

  ctx.fillStyle = "#1b1612";
  roundRect(ctx, card.x + 21, card.y + 16, 333, 40, 8);
  ctx.fill();

  ctx.fillStyle = "#f6efe3";
  ctx.font = "700 28px Georgia, 'Times New Roman', serif";
  ctx.textBaseline = "middle";
  ctx.fillText(card.name, card.x + 39, card.y + 36);

  const artX = card.x + 24;
  const artY = card.y + 62;
  const artW = 327;
  const artH = Math.min(210, height - 90);
  ctx.fillStyle = "#2c241c";
  roundRect(ctx, artX, artY, artW, artH, 6);
  ctx.fill();
  ctx.fillStyle = card.die ? "#4a3024" : "#355f7a";
  roundRect(ctx, artX + 6, artY + 6, artW - 12, artH - 12, 4);
  ctx.fill();
  ctx.strokeStyle = "#d4b26a";
  ctx.lineWidth = 3;
  roundRect(ctx, artX + 6, artY + 6, artW - 12, artH - 12, 4);
  ctx.stroke();

  if (card.die) drawDie(ctx, card.x + 54, card.y + 150, card.die);
}

function drawCardBody(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, width, height, 21);
  ctx.fill();
  ctx.strokeStyle = "#1b1612";
  ctx.lineWidth = 5;
  roundRect(ctx, x, y, width, height, 21);
  ctx.stroke();
}

function drawDie(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  value: number,
): void {
  ctx.fillStyle = "#c62828";
  roundRect(ctx, x, y, 96, 96, 16);
  ctx.fill();
  ctx.strokeStyle = "#7f1515";
  ctx.lineWidth = 4;
  roundRect(ctx, x, y, 96, 96, 16);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "700 58px Figtree, 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(value), x + 48, y + 52);
  ctx.textAlign = "start";
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not encode the sample photo."));
          return;
        }
        resolve(blob);
      },
      "image/png",
    );
  });
}
