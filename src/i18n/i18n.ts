export type Lang = 'ja' | 'en';

const dict = {
  'app.title': { ja: 'PHAGE: Inner World', en: 'PHAGE: Inner World' },
  'app.subtitle': { ja: '1体のファージから始まる、感染と増殖の観察', en: 'Observe an infection that begins with a single phage' },
  'start.lead': {
    ja: 'ヒト腸管の粘液層に広がる細菌バイオフィルム。ここに溶菌性ファージを1体だけ放ち、感染・複製・溶菌の連鎖を細胞レベルで追跡します。',
    en: 'A bacterial biofilm on the human intestinal mucus layer. Release a single lytic phage and follow the chain of infection, replication and lysis at the cellular scale.',
  },
  'start.note': {
    ja: 'バクテリオファージは細菌に感染するウイルスです。本作はヒト細胞への感染を扱わず、腸内細菌群集を介した増殖を描きます。',
    en: 'Bacteriophages are viruses that infect bacteria. This simulation does not depict infection of human cells; growth happens through the gut bacterial community.',
  },
  'start.choosePhage': { ja: '観察するファージ', en: 'Phage to observe' },
  'start.settings': { ja: '実験条件', en: 'Experiment' },
  'start.seed': { ja: '乱数シード', en: 'Random seed' },
  'start.cells': { ja: '初期細菌数', en: 'Initial cells' },
  'start.nonhost': { ja: '非適合種の割合', en: 'Non-host share' },
  'start.quality': { ja: '描画品質', en: 'Graphics' },
  'start.begin': { ja: '環境へ入る', en: 'Enter the environment' },
  'start.continue': { ja: '続きから', en: 'Continue' },
  'start.latent': { ja: '潜伏期', en: 'Latent period' },
  'start.burst': { ja: 'バーストサイズ', en: 'Burst size' },
  'start.host': { ja: '宿主', en: 'Host' },
  'quality.auto': { ja: '自動', en: 'Auto' },
  'quality.high': { ja: '高', en: 'High' },
  'quality.medium': { ja: '中', en: 'Medium' },
  'quality.low': { ja: '低', en: 'Low' },
  'place.title': { ja: '投入地点を選択', en: 'Choose a release point' },
  'place.hint': {
    ja: '画面をタップ／クリックして、ファージを放つ地点を決めてください。宿主のコロニー（青）の近くほど早く感染が始まります。',
    en: 'Tap or click to choose where to release the phage. Closer to a host colony (blue) means an earlier infection.',
  },
  'place.auto': { ja: '自動で配置', en: 'Place automatically' },
  'place.confirm': { ja: 'ここに投入', en: 'Release here' },

  'time.pause': { ja: '一時停止', en: 'Pause' },
  'time.play': { ja: '再生', en: 'Play' },
  'time.step': { ja: '1ステップ進める', en: 'Step once' },
  'time.saturated': { ja: '処理上限のため実効速度が低下しています', en: 'Running slower than requested (CPU budget)' },
  'time.sim': { ja: 'シミュレーション時間', en: 'Simulation time' },

  'stats.title': { ja: '個体群', en: 'Populations' },
  'stats.phage': { ja: 'ファージ', en: 'Phages' },
  'stats.free': { ja: '自由粒子', en: 'Free particles' },
  'stats.individual': { ja: '個体モデル', en: 'individual model' },
  'stats.population': { ja: '集団モデル', en: 'population model' },
  'stats.intracellular': { ja: '細胞内（成熟）', en: 'Intracellular (mature)' },
  'stats.bacteria': { ja: '細菌', en: 'Bacteria' },
  'stats.lysed': { ja: '溶菌した細胞（累計）', en: 'Lysed cells (total)' },
  'stats.nutrient': { ja: '平均栄養濃度', en: 'Mean nutrient' },
  'chart.phage': { ja: 'ファージ数（対数）', en: 'Phages (log scale)' },
  'chart.bacteria': { ja: '細菌数', en: 'Bacteria' },
  'chart.table': { ja: '表で見る', en: 'Table view' },
  'chart.time': { ja: '時刻', en: 'Time' },

  'state.susceptible': { ja: '感受性', en: 'Susceptible' },
  'state.infected': { ja: '感染中', en: 'Infected' },
  'state.resistant': { ja: '抵抗性', en: 'Resistant' },
  'state.dead': { ja: '死亡・溶菌', en: 'Dead / lysed' },
  'state.inactive': { ja: '休眠', en: 'Dormant' },
  'state.nonhost': { ja: '非適合種', en: 'Non-host species' },

  'phage.state.0': { ja: '自由状態', en: 'Free' },
  'phage.state.1': { ja: '吸着', en: 'Adsorbed' },
  'phage.state.2': { ja: '感染成立', en: 'Infected' },
  'phage.state.3': { ja: '溶菌', en: 'Lytic' },
  'phage.state.4': { ja: '溶原（未実装）', en: 'Lysogenic (n/a)' },
  'phage.state.5': { ja: '消失', en: 'Lost' },
  'phage.state.desc.0': { ja: '環境中をブラウン運動で漂っている', en: 'Drifting through the medium by Brownian motion' },
  'phage.state.desc.1': { ja: '尾繊維で細菌表面の受容体に結合している', en: 'Bound to surface receptors by its tail fibres' },
  'phage.state.desc.2': { ja: 'DNAを注入し、細胞内で複製が進んでいる', en: 'Genome injected; replication under way inside the cell' },
  'phage.state.desc.3': { ja: '細胞が破裂し、子孫が放出された', en: 'The cell burst and progeny were released' },
  'phage.state.desc.5': { ja: '追跡対象が失活または排除された', en: 'The tracked particle was inactivated or excluded' },

  'stage.0': { ja: '—', en: '—' },
  'stage.1': { ja: '吸着', en: 'Adsorption' },
  'stage.2': { ja: 'DNA注入', en: 'DNA injection' },
  'stage.3': { ja: '宿主の乗っ取り', en: 'Host takeover' },
  'stage.4': { ja: 'ゲノム複製', en: 'Genome replication' },
  'stage.5': { ja: '粒子の組み立て', en: 'Virion assembly' },
  'stage.6': { ja: '溶菌', en: 'Lysis' },
  'stage.desc.1': { ja: '尾繊維が受容体を探り、基盤が細胞表面に固定される。', en: 'Tail fibres find receptors and the baseplate locks onto the surface.' },
  'stage.desc.2': { ja: '尾鞘が収縮し、頭部のDNAが細胞内へ送り込まれる。', en: 'The sheath contracts and the genome is pushed into the cell.' },
  'stage.desc.3': { ja: 'ファージ遺伝子が発現し、宿主DNAが分解されていく。', en: 'Phage genes are expressed and host DNA is degraded.' },
  'stage.desc.4': { ja: 'ファージゲノムが大量に複製される（暗黒期）。', en: 'The phage genome is copied many times (eclipse).' },
  'stage.desc.5': { ja: 'カプシドが組み上がり、DNAが詰め込まれて成熟粒子が増えていく。', en: 'Capsids assemble and are packed with DNA; mature virions accumulate.' },

  'inspector.title': { ja: '観察対象', en: 'Observation target' },
  'inspector.none': { ja: '画面上の細菌やファージをクリック／タップすると詳細を表示します。', en: 'Click or tap a bacterium or phage to inspect it.' },
  'inspector.tracked': { ja: '追跡中のファージ', en: 'Tracked phage' },
  'inspector.cell': { ja: '細菌', en: 'Bacterium' },
  'inspector.phage': { ja: 'ファージ粒子', en: 'Phage particle' },
  'inspector.id': { ja: '個体ID', en: 'ID' },
  'inspector.generation': { ja: '世代', en: 'Generation' },
  'inspector.genUnknown': { ja: '不明（集団モデル由来）', en: 'unknown (from population model)' },
  'inspector.parent': { ja: '親', en: 'Parent' },
  'inspector.species': { ja: '種', en: 'Species' },
  'inspector.state': { ja: '状態', en: 'State' },
  'inspector.length': { ja: '全長', en: 'Length' },
  'inspector.activity': { ja: '代謝活性', en: 'Activity' },
  'inspector.stage': { ja: '感染段階', en: 'Infection stage' },
  'inspector.inside': { ja: '細胞内の成熟粒子', en: 'Mature virions inside' },
  'inspector.expectedBurst': { ja: '予定バースト', en: 'Expected burst' },
  'inspector.lysisIn': { ja: '溶菌まで', en: 'Lysis in' },
  'inspector.excluded': { ja: '排除した後続ファージ', en: 'Excluded superinfections' },
  'inspector.host': { ja: '宿主細胞', en: 'Host cell' },
  'inspector.follow': { ja: 'カメラ追従', en: 'Follow' },
  'inspector.track': { ja: 'この粒子を追跡', en: 'Track this particle' },
  'inspector.lineage': { ja: '系譜', en: 'Lineage' },
  'inspector.age': { ja: '経過', en: 'Age' },
  'lineage.introduced': { ja: '投入個体', en: 'Introduced' },
  'lineage.progeny': { ja: '子孫', en: 'Progeny' },
  'lineage.sibling': { ja: '兄弟へ切替', en: 'Switched to sibling' },
  'lineage.manual': { ja: '手動で切替', en: 'Switched manually' },

  'camera.title': { ja: 'カメラ', en: 'Camera' },
  'camera.recenter': { ja: '追跡対象へ戻る', en: 'Return to target' },
  'camera.overview': { ja: '全体', en: 'Overview' },
  'camera.cutaway': { ja: '断面', en: 'Cutaway' },
  'camera.bookmarks': { ja: '視点', en: 'Views' },
  'camera.saveView': { ja: '現在の視点を保存', en: 'Save current view' },
  'camera.followOn': { ja: '追従中', en: 'Following' },
  'camera.followOff': { ja: '自由', en: 'Free' },

  'log.title': { ja: 'イベントログ', en: 'Event log' },
  'log.empty': { ja: 'まだ記録はありません', en: 'Nothing recorded yet' },

  'menu.save': { ja: 'セーブ', en: 'Save' },
  'menu.load': { ja: 'ロード', en: 'Load' },
  'menu.export': { ja: 'ファイルに書き出す', en: 'Export file' },
  'menu.import': { ja: 'ファイルから読み込む', en: 'Import file' },
  'menu.slot': { ja: 'スロット', en: 'Slot' },
  'menu.empty': { ja: '空き', en: 'Empty' },
  'menu.model': { ja: 'モデル情報', en: 'Model info' },
  'menu.restart': { ja: '最初から', en: 'Restart' },
  'menu.help': { ja: '操作方法', en: 'Controls' },
  'menu.saved': { ja: '保存しました', en: 'Saved' },
  'menu.loaded': { ja: '読み込みました', en: 'Loaded' },
  'menu.failed': { ja: '失敗しました', en: 'Failed' },
  'menu.close': { ja: '閉じる', en: 'Close' },

  'model.title': { ja: 'モデル情報と根拠', en: 'Model & evidence' },
  'model.lead': {
    ja: '表示されている挙動は、下記のパラメータと仮定から計算されています。実測値・近似・演出を区別して表示します。',
    en: 'Everything you see is computed from the parameters and assumptions below. Measured values, approximations and presentational choices are labelled.',
  },
  'model.param': { ja: 'パラメータ', en: 'Parameter' },
  'model.value': { ja: '値', en: 'Value' },
  'model.evidence': { ja: '根拠', en: 'Evidence' },
  'model.source': { ja: '出典・説明', en: 'Source / note' },
  'model.uncertainty': { ja: '不確実性', en: 'Uncertainty' },
  'model.version': { ja: 'モデルバージョン', en: 'Model version' },
  'model.hash': { ja: '状態ハッシュ', en: 'State hash' },
  'model.seed': { ja: 'シード', en: 'Seed' },
  'model.assumptions': { ja: '主なモデル上の仮定', en: 'Key modelling assumptions' },
  'model.a1': { ja: '細胞内のファージ粒子は個別に計算せず、感染細胞の状態（段階と経過時間）として保持します。', en: 'Intracellular particles are not simulated one by one; the infected cell holds the stage and elapsed time.' },
  'model.a2': { ja: '遠方の自由ファージは区画（10 µm）ごとの個体数で扱い、追跡対象の周辺だけを個体として計算します。総数は両モードで一致します。', en: 'Distant free phages are counted per 10 µm voxel; only the region around the tracked particle is simulated individually. Totals agree between modes.' },
  'model.a3': { ja: '感染済み細胞に後から吸着したファージは排除されます（重複感染排除の抽象化）。溶菌阻止（LIN）や溶原化は扱いません。', en: 'Phages adsorbing to an already infected cell are excluded (abstracted superinfection exclusion). Lysis inhibition and lysogeny are not modelled.' },
  'model.a4': { ja: '細菌密度はバイオフィルムを想定しており、浮遊培養の典型値より高い設定です。耐性変異率は観察のため大きく誇張しています。', en: 'Cell density reflects a biofilm and is higher than typical planktonic cultures. The resistance mutation rate is deliberately exaggerated for observability.' },
  'model.a5': { ja: '免疫系、粘液の流れ、温度・pHの影響は本バージョンでは計算に含めていません。', en: 'Immunity, mucus flow, and temperature/pH effects are not part of this version’s computation.' },
  'model.a6': { ja: '3D表示のファージは実寸です。遠景では蛍光標識した粒子のような光点として描画します（演出）。', en: 'Phage models are drawn at true scale; at a distance they appear as glowing dots like fluorescently labelled particles (presentational).' },
  'evidence.literature-range': { ja: '文献値の範囲', en: 'Literature range' },
  'evidence.approximation': { ja: '近似', en: 'Approximation' },
  'evidence.assumption': { ja: '仮定', en: 'Assumption' },
  'modeltype.measured': { ja: '実測ベース', en: 'Measured' },
  'modeltype.approximate': { ja: '近似モデル', en: 'Approximate' },
  'modeltype.presentational': { ja: '演出・表示用', en: 'Presentational' },

  'scale.body': { ja: '生物全体', en: 'Organism' },
  'scale.organ': { ja: '臓器', en: 'Organ' },
  'scale.tissue': { ja: '組織', en: 'Tissue' },
  'scale.community': { ja: '微生物群集', en: 'Community' },
  'scale.cell': { ja: '細菌', en: 'Bacterium' },
  'scale.interior': { ja: '細胞内部', en: 'Cell interior' },
  'scale.future': { ja: '今後のフェーズで実装予定', en: 'Planned for a later phase' },

  'help.title': { ja: '操作方法', en: 'Controls' },
  'help.mouse': { ja: 'マウス：左ドラッグで回転 / 右ドラッグで移動 / ホイールで拡大縮小 / クリックで選択 / ダブルクリックで追従', en: 'Mouse: left-drag rotate / right-drag pan / wheel zoom / click select / double-click follow' },
  'help.touch': { ja: 'タッチ：1本指で回転 / 2本指で移動・ピンチで拡大縮小 / タップで選択 / ダブルタップで追従', en: 'Touch: one finger rotate / two fingers pan & pinch zoom / tap select / double-tap follow' },
  'help.keys': { ja: 'キー：Space 再生/停止・1〜5 速度・F 追跡対象へ・C 断面・O 全体・L 言語', en: 'Keys: Space play/pause · 1–5 speed · F target · C cutaway · O overview · L language' },

  'event.0': { ja: 'ファージを1体投入した', en: 'A single phage was released' },
  'event.1': { ja: '細菌 #{a} に吸着', en: 'Adsorbed to cell #{a}' },
  'event.2': { ja: '細菌 #{a} へDNAを注入', en: 'Genome injected into cell #{a}' },
  'event.3': { ja: '細菌 #{a} が溶菌し {v} 体を放出', en: 'Cell #{a} lysed, releasing {v}' },
  'event.5': { ja: '耐性変異株が出現（細菌 #{a}）', en: 'A resistant mutant appeared (cell #{a})' },
  'event.6': { ja: '感染済みの細菌 #{a} に吸着し排除された', en: 'Excluded by already-infected cell #{a}' },
  'event.10': { ja: '追跡個体が失活した', en: 'The tracked particle was inactivated' },
  'event.11.0': { ja: '子孫 #{a}（第{g}世代）の追跡を開始', en: 'Now tracking progeny #{a} (generation {g})' },
  'event.11.1': { ja: '兄弟粒子 #{a} に追跡を切り替えた', en: 'Tracking switched to sibling #{a}' },
  'event.11.2': { ja: '粒子 #{a} の追跡を開始', en: 'Now tracking particle #{a}' },
  'milestone.0': { ja: '最初の感染が成立した', en: 'First infection established' },
  'milestone.1': { ja: '最初の溶菌が起きた', en: 'First lysis' },
  'milestone.2': { ja: '自由ファージが100体を超えた', en: 'Free phages exceeded 100' },
  'milestone.3': { ja: '自由ファージが1,000体を超えた', en: 'Free phages exceeded 1,000' },
  'milestone.4': { ja: '自由ファージが10,000体を超えた', en: 'Free phages exceeded 10,000' },
  'milestone.5': { ja: '宿主細菌が最大時の半数を下回った', en: 'Host cells fell below half of their peak' },
  'milestone.6': { ja: '宿主集団がほぼ崩壊した', en: 'The host population has nearly collapsed' },
  'milestone.7': { ja: '耐性株が宿主集団の多数派になった', en: 'Resistant cells now dominate the host population' },
  'milestone.8': { ja: 'ファージが消滅した', en: 'The phage population went extinct' },
  'milestone.9': { ja: '系譜が途切れた（追跡可能な粒子がない）', en: 'The lineage ended (no particle left to track)' },
  'param.adsorptionRate': { ja: '吸着速度定数', en: 'Adsorption rate constant' },
  'param.diffusion': { ja: '拡散係数', en: 'Diffusion coefficient' },
  'param.adsorbPhase': { ja: '吸着段階の長さ', en: 'Binding phase duration' },
  'param.injectPhase': { ja: 'DNA注入の長さ', en: 'Injection duration' },
  'param.eclipse': { ja: '暗黒期', en: 'Eclipse period' },
  'param.latentMean': { ja: '潜伏期（平均）', en: 'Latent period (mean)' },
  'param.latentSd': { ja: '潜伏期（標準偏差）', en: 'Latent period (SD)' },
  'param.burstMean': { ja: 'バーストサイズ（平均）', en: 'Burst size (mean)' },
  'param.burstSd': { ja: 'バーストサイズ（標準偏差）', en: 'Burst size (SD)' },
  'param.decayRate': { ja: '失活・排除率', en: 'Inactivation / clearance rate' },
  'param.radius': { ja: '半径', en: 'Radius' },
  'param.birthHalfLength': { ja: '誕生時の円柱半長', en: 'Half cylinder length at birth' },
  'param.divisionHalfLength': { ja: '分裂時の円柱半長', en: 'Half cylinder length at division' },
  'param.doublingTime': { ja: '倍加時間', en: 'Doubling time' },
  'param.resistanceMutation': { ja: '耐性変異率', en: 'Resistance mutation rate' },
  'param.resistanceCost': { ja: '耐性の成長コスト', en: 'Fitness cost of resistance' },
  'param.initialResistant': { ja: '既存の耐性株の割合', en: 'Pre-existing resistant fraction' },
  'param.deathRate': { ja: '自然死率', en: 'Background death rate' },
  'param.sizeX': { ja: '区画の幅', en: 'Compartment width' },
  'param.sizeY': { ja: '区画の高さ', en: 'Compartment height' },
  'param.sizeZ': { ja: '区画の奥行き', en: 'Compartment depth' },
  'param.voxelSize': { ja: 'ボクセルの大きさ', en: 'Voxel size' },
  'param.nutrientHalfSat': { ja: '栄養の半飽和定数', en: 'Nutrient half-saturation' },
  'param.nutrientUptake': { ja: '栄養消費量', en: 'Nutrient uptake' },
  'param.nutrientInflow': { ja: '栄養供給率', en: 'Nutrient inflow' },
  'param.nutrientDiffusion': { ja: '栄養の拡散', en: 'Nutrient diffusion' },
  'param.dormancyThreshold': { ja: '休眠の閾値', en: 'Dormancy threshold' },
  'param.temperature': { ja: '温度', en: 'Temperature' },
  'param.pH': { ja: 'pH', en: 'pH' },
  'units.min': { ja: '分', en: 'min' },
  'units.s': { ja: '秒', en: 's' },
} as const;

export type I18nKey = keyof typeof dict;

let current: Lang = detect();
const listeners: (() => void)[] = [];

function detect(): Lang {
  try {
    const saved = localStorage.getItem('phage-inner-world/lang');
    if (saved === 'ja' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== 'undefined' && !navigator.language.startsWith('ja') ? 'en' : 'ja';
}

export function lang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  current = l;
  try {
    localStorage.setItem('phage-inner-world/lang', l);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = l;
  for (const f of listeners) f();
}

export function onLangChange(f: () => void): void {
  listeners.push(f);
}

export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  let s: string = dict[key][current];
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

/** Lookup for dynamically composed keys (falls back to the key itself). */
export function tk(key: string, vars?: Record<string, string | number>): string {
  return key in dict ? t(key as I18nKey, vars) : key;
}

export function loc(text: { ja: string; en: string }): string {
  return text[current];
}

export function fmtTime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString(current === 'ja' ? 'ja-JP' : 'en-US');
}
