import './md2-isometric.css';

import { useId } from 'react';

import {
  ISOMETRIC_ROOMS,
  type IsometricTask,
  liveProgrammer,
  projectOffice,
  workstationPositions,
} from './md2Isometric.js';

const asset = (category: string, name: string) => `/assets/furniture/${category}/${name}.png`;
function polygon(points: number[][]) {
  return points
    .map(([x, y, z = 0]) => {
      const point = projectOffice(x, y, z);
      return `${point.x},${point.y}`;
    })
    .join(' ');
}
function Plant({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cy="4" rx="13" ry="5" fill="var(--iso-shadow)" />
      <image href={asset('LARGE_PLANT', 'LARGE_PLANT')} x="-19" y="-51" width="38" height="57" />
    </g>
  );
}
function Person({
  x,
  y,
  palette,
  live = false,
  approval = false,
}: {
  x: number;
  y: number;
  palette: number;
  live?: boolean;
  approval?: boolean;
}) {
  return (
    <g transform={`translate(${x} ${y})`} data-character-kind={live ? 'session' : 'planned'}>
      <ellipse cy="3" rx="12" ry="4" fill="var(--iso-shadow)" />
      <g
        style={{ animationDelay: `${palette * -0.37}s` }}
        className={
          live
            ? approval
              ? 'iso-person iso-person-await'
              : 'iso-person iso-person-live'
            : 'iso-person iso-person-planned'
        }
      >
        <svg x="-14" y="-51" width="28" height="56" viewBox="0 0 16 32" overflow="hidden">
          <image
            className={live && !approval ? 'iso-typing' : ''}
            href={`/assets/characters/char_${palette % 6}.png`}
            x={live && !approval ? -48 : 0}
            width="112"
            height="96"
          />
        </svg>
      </g>
      {live && (
        <g>
          <circle
            cx="13"
            cy="-47"
            r="8"
            fill={approval ? 'var(--iso-amber)' : 'var(--iso-green)'}
          />
          <text x="13" y="-44" textAnchor="middle" className="iso-status-symbol">
            {approval ? '?' : '✓'}
          </text>
        </g>
      )}
    </g>
  );
}
function Desk({
  x,
  y,
  palette,
  live,
  approval,
}: {
  x: number;
  y: number;
  palette: number;
  live?: boolean;
  approval?: boolean;
}) {
  const p = projectOffice(x, y);
  return (
    <g transform={`translate(${p.x} ${p.y})`} data-workstation="true">
      <polygon
        points={polygon([
          [-26, -15, 0],
          [26, -15, 0],
          [26, 15, 0],
          [-26, 15, 0],
        ])}
        fill="var(--iso-shadow)"
      />
      <path
        d="M-30,-8 v25 h7 v-21 M21,1 v22 h7 v-26"
        stroke="var(--iso-wood-dark)"
        strokeWidth="5"
      />
      <polygon
        points={polygon([
          [-29, -17, 23],
          [29, -17, 23],
          [29, 17, 23],
          [-29, 17, 23],
        ])}
        fill="var(--iso-wood)"
        stroke="var(--iso-gold)"
        strokeWidth="1.5"
      />
      <polygon
        points={polygon([
          [-29, 17, 23],
          [29, 17, 23],
          [29, 17, 18],
          [-29, 17, 18],
        ])}
        fill="var(--iso-wood-dark)"
      />
      <Person x={-6} y={13} palette={palette} live={live} approval={approval} />
      <image
        href={asset('PC', live ? 'PC_FRONT_ON_1' : 'PC_FRONT_OFF')}
        x="-10"
        y="-53"
        width="32"
        height="35"
      />
      <path d="M-7,-19 l15,4 l-6,3 l-15,-4 z" fill="var(--iso-keyboard)" />
      <rect x="18" y="-23" width="5" height="7" rx="1" fill="var(--iso-paper)" />
    </g>
  );
}
function Room({
  name,
  positions,
  x,
  y,
  index,
  live,
  approval,
  onOpen,
  glow,
}: {
  name: string;
  positions: number;
  x: number;
  y: number;
  index: number;
  live?: boolean;
  approval?: boolean;
  onOpen?: () => void;
  glow: string;
}) {
  const colors = [
    'var(--iso-commercial)',
    'var(--iso-marketing)',
    'var(--iso-operations)',
    'var(--iso-strategy)',
    'var(--iso-finance)',
    'var(--iso-technology)',
    'var(--iso-support)',
    'var(--iso-ceo)',
  ];
  const color = colors[index];
  return (
    <g
      transform={`translate(${x} ${y})`}
      data-room={name}
      role={onOpen ? 'button' : 'group'}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={`${name} · ${positions} ${name === 'CEO · Você' ? 'posição exclusiva' : 'cargos planejados'}${live ? ' · Codex conectado' : ''}`}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
    >
      <title>
        {name} —{' '}
        {live ? 'Sessão real do Programador Codex' : 'Cargos planejados; personagens ilustrativos'}
      </title>
      <polygon
        points={polygon([
          [0, 0, -8],
          [218, 0, -8],
          [218, 108, -8],
          [0, 108, -8],
        ])}
        fill="var(--iso-shadow)"
      />
      <polygon
        points={polygon([
          [0, 0],
          [218, 0],
          [218, 108],
          [0, 108],
        ])}
        fill="var(--iso-floor)"
        stroke="var(--iso-gold)"
        strokeWidth="3"
      />
      {Array.from({ length: 10 }, (_, i) => (
        <path
          key={`x${i}`}
          d={`M${projectOffice(i * 24, 0).x},${projectOffice(i * 24, 0).y} L${projectOffice(i * 24, 108).x},${projectOffice(i * 24, 108).y}`}
          className="iso-floor-line"
        />
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <path
          key={`y${i}`}
          d={`M${projectOffice(0, i * 24).x},${projectOffice(0, i * 24).y} L${projectOffice(218, i * 24).x},${projectOffice(218, i * 24).y}`}
          className="iso-floor-line"
        />
      ))}
      <polygon
        points={polygon([
          [0, 0],
          [218, 0],
          [218, 0, 72],
          [0, 0, 72],
        ])}
        fill="var(--iso-wall-back)"
        stroke="var(--iso-wall-edge)"
        strokeWidth="3"
      />
      <polygon
        points={polygon([
          [0, 0],
          [0, 108],
          [0, 108, 72],
          [0, 0, 72],
        ])}
        fill="var(--iso-wall-side)"
        stroke="var(--iso-wall-edge)"
        strokeWidth="3"
      />
      <polygon
        points={polygon([
          [8, 0, 27],
          [205, 0, 27],
          [205, 0, 64],
          [8, 0, 64],
        ])}
        fill="var(--iso-window)"
        stroke="var(--iso-window-edge)"
        strokeWidth="2"
      />
      {Array.from({ length: 6 }, (_, i) => {
        const a = projectOffice(18 + i * 33, 0, 30);
        const b = projectOffice(18 + i * 33, 0, 62);
        return (
          <path
            key={i}
            d={`M${a.x},${a.y} L${b.x},${b.y}`}
            stroke="var(--iso-window-edge)"
            strokeWidth="3"
          />
        );
      })}
      <ellipse cx="65" cy="35" rx="105" ry="60" fill={`url(#${glow})`} pointerEvents="none" />
      <image
        href={asset('DOUBLE_BOOKSHELF', 'DOUBLE_BOOKSHELF')}
        x="-48"
        y="-20"
        width="40"
        height="43"
      />
      <g transform="matrix(.866 .5 0 1 40 -47)">
        <rect
          width="102"
          height="43"
          rx="2"
          fill={index === 5 ? 'var(--iso-sign)' : 'var(--iso-paper)'}
          stroke="var(--iso-gold)"
          strokeWidth="2"
        />
        {index === 5 ? (
          Array.from({ length: 6 }, (_, i) => (
            <path
              key={i}
              d={`M8 ${8 + i * 5}h${37 + ((i * 13) % 49)}`}
              stroke={color}
              strokeWidth="2"
            />
          ))
        ) : (
          <>
            <path
              d="M8 32L24 25L40 28L56 12L73 18L92 8"
              fill="none"
              stroke={color}
              strokeWidth="3"
            />
            {[16, 29, 21, 35].map((height, i) => (
              <rect
                key={i}
                x={12 + i * 20}
                y={41 - height}
                width="10"
                height={height}
                fill={color}
                opacity=".35"
              />
            ))}
          </>
        )}
      </g>
      <Plant x={-62} y={64} />
      <Plant x={173} y={110} />
      {workstationPositions(positions).map((p, i) => (
        <Desk
          key={i}
          {...p}
          palette={index + i}
          live={live && i === 0}
          approval={approval && i === 0}
        />
      ))}
      <g transform="translate(48 -58)">
        <rect
          x="-70"
          width="185"
          height="25"
          rx="3"
          fill={color}
          stroke="var(--iso-gold)"
          strokeWidth="1.5"
        />
        <text x="22" y="16" textAnchor="middle" className="iso-room-title">
          {name.toLocaleUpperCase('pt-BR')}
        </text>
      </g>
      <g transform="translate(112 138)">
        <rect x="-34" y="-12" width="112" height="20" rx="4" fill="var(--iso-sign)" />
        <text x="22" y="2" textAnchor="middle" className="iso-count">
          {name.startsWith('CEO') ? 'Você · CEO' : `${positions} cargos planejados`}
        </text>
      </g>
    </g>
  );
}
export function Md2IsometricOffice({
  tasks,
  onOpen,
}: {
  tasks: IsometricTask[];
  onOpen: () => void;
}) {
  const id = useId().replaceAll(':', '');
  const live = liveProgrammer(tasks);
  return (
    <section
      className="md2-office-region md2-isometric-office"
      aria-label="Escritório isométrico MD2"
    >
      <svg
        viewBox="0 0 1100 790"
        preserveAspectRatio="none"
        role="group"
        aria-labelledby={`${id}-title ${id}-description`}
        className="iso-scene"
        data-testid="md2-isometric-scene"
      >
        <title id={`${id}-title`}>MD2 IA Office — sete departamentos, recepção central e CEO</title>
        <desc id={`${id}-description`}>
          20 cargos planejados, mais CEO e recepção. Personagens ilustrativos em animação ambiente;
          somente o Programador Codex conectado representa execução real.{' '}
          {live ? 'Há uma sessão Codex conectada.' : 'Nenhuma sessão Codex em execução.'}
        </desc>
        <defs>
          <pattern id={`${id}-floor`} width="32" height="24" patternUnits="userSpaceOnUse">
            <rect width="32" height="24" fill="var(--iso-corridor)" />
            <path
              d="M0 0H32V24H0Z M16 0V24"
              fill="none"
              stroke="var(--iso-grout)"
              strokeWidth="0.6"
            />
          </pattern>
          <radialGradient id={`${id}-glow`}>
            <stop stopColor="var(--iso-light)" stopOpacity=".38" />
            <stop offset="1" stopColor="var(--iso-light)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-sky`} x2="0" y2="1">
            <stop stopColor="var(--iso-sky)" />
            <stop offset="1" stopColor="var(--iso-window)" />
          </linearGradient>
        </defs>
        <rect
          x="8"
          y="8"
          width="1084"
          height="774"
          rx="12"
          fill={`url(#${id}-floor)`}
          stroke="var(--iso-wall-edge)"
          strokeWidth="8"
        />
        <rect
          x="375"
          y="12"
          width="330"
          height="170"
          fill={`url(#${id}-sky)`}
          stroke="var(--iso-gold)"
          strokeWidth="6"
        />
        {Array.from({ length: 14 }, (_, i) => (
          <rect
            key={i}
            x={385 + i * 23}
            y={60 + ((i * 17) % 65)}
            width="15"
            height={105 - ((i * 17) % 65)}
            fill="var(--iso-building)"
            opacity=".8"
          />
        ))}
        <Room name="CEO · Você" positions={1} x={510} y={108} index={7} glow={`${id}-glow`} />
        {ISOMETRIC_ROOMS.filter((room) => room.id !== 'support').map((room, index) => (
          <Room
            key={room.id}
            name={room.name}
            positions={room.positions}
            x={room.x}
            y={room.y}
            index={index}
            live={room.id === 'technology' && !!live}
            approval={live?.status === 'approval'}
            onOpen={room.id === 'technology' ? onOpen : undefined}
            glow={`${id}-glow`}
          />
        ))}
        <g transform="translate(425 280)" data-room="Recepção">
          <rect
            x="-17"
            y="-24"
            width="226"
            height="95"
            rx="5"
            fill="var(--iso-sign)"
            stroke="var(--iso-gold)"
            strokeWidth="3"
          />
          <text x="96" y="10" textAnchor="middle" className="iso-brand-main">
            MD2
          </text>
          <text x="96" y="37" textAnchor="middle" className="iso-brand-sub">
            IA OFFICE
          </text>
          <Person x={94} y={118} palette={3} />
          <polygon points="-8,119 172,119 192,135 11,135" fill="var(--iso-paper)" />
          <path
            d="M11 135H192V170H11Z"
            fill="var(--iso-reception)"
            stroke="var(--iso-gold)"
            strokeWidth="2"
          />
          <image href={asset('PC', 'PC_FRONT_OFF')} x="39" y="89" width="35" height="37" />
          <text x="100" y="157" textAnchor="middle" className="iso-room-title">
            RECEPÇÃO
          </text>
          <Plant x={-24} y={140} />
          <Plant x={215} y={140} />
        </g>
        {ISOMETRIC_ROOMS.filter((room) => room.id === 'support').map((room) => (
          <Room
            key={room.id}
            name={room.name}
            positions={room.positions}
            x={room.x}
            y={555}
            index={6}
            glow={`${id}-glow`}
          />
        ))}
        <g transform="translate(454 720)">
          <image href={asset('SOFA', 'SOFA_FRONT')} x="-45" y="-38" width="78" height="48" />
          <image href={asset('SOFA', 'SOFA_FRONT')} x="125" y="-38" width="78" height="48" />
          <ellipse
            cx="80"
            cy="-2"
            rx="34"
            ry="17"
            fill="var(--iso-wood)"
            stroke="var(--iso-gold)"
            strokeWidth="3"
          />
          <Plant x={80} y={-5} />
        </g>
        {[
          [345, 205],
          [720, 205],
          [345, 440],
          [735, 440],
          [340, 704],
          [745, 704],
        ].map(([x, y], i) => (
          <g key={i}>
            <ellipse cx={x} cy={y - 24} rx="42" ry="58" fill={`url(#${id}-glow)`} />
            <path d={`M${x} ${y}V${y - 43}`} stroke="var(--iso-gold)" strokeWidth="4" />
            <path d={`M${x - 12} ${y - 43}h24l-5,-17h-14z`} fill="var(--iso-light)" />
            <Plant x={x + 28} y={y + 16} />
          </g>
        ))}
      </svg>
      <div className="iso-caption">
        <span>20 cargos planejados · animação ambiente</span>
        <button onClick={onOpen}>
          {live
            ? live.status === 'approval'
              ? 'Codex aguarda aprovação'
              : 'Ver sessão Codex'
            : 'Abrir tarefas e aprovações'}
        </button>
      </div>
    </section>
  );
}
