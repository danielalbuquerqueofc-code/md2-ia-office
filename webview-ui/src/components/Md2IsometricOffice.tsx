import './md2-isometric.css';

import { useId } from 'react';

import {
  ISOMETRIC_ROOMS,
  type IsometricTask,
  liveProgrammer,
  projectReferenceOffice as project,
  workstationPositions,
} from './md2Isometric.js';

const asset = (category: string, name: string) => `/assets/furniture/${category}/${name}.png`;
const points = (vertices: number[][]) =>
  vertices
    .map(([x, y, z = 0]) => {
      const p = project(x, y, z);
      return `${p.x},${p.y}`;
    })
    .join(' ');
const floor = [
  [0, 0],
  [300, 0],
  [300, 180],
  [0, 180],
];
function Plant({ x, y, large = false }: { x: number; y: number; large?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cy="2" rx="16" ry="5" fill="var(--iso-shadow)" />
      <image
        href={asset('LARGE_PLANT', 'LARGE_PLANT')}
        x={large ? -23 : -17}
        y={large ? -68 : -51}
        width={large ? 46 : 34}
        height={large ? 69 : 51}
      />
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
      <ellipse cy="3" rx="10" ry="4" fill="var(--iso-shadow)" />
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
        <svg x="-14" y="-55" width="28" height="56" viewBox="0 0 16 32" overflow="hidden">
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
            cx="17"
            cy="-50"
            r="8"
            fill={approval ? 'var(--iso-amber)' : 'var(--iso-green)'}
          />
          <text x="17" y="-46" textAnchor="middle" className="iso-status-symbol">
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
  executive = false,
  live,
  approval,
}: {
  x: number;
  y: number;
  palette: number;
  executive?: boolean;
  live?: boolean;
  approval?: boolean;
}) {
  const p = project(x, y);
  const half = executive ? 78 : 40;
  return (
    <g transform={`translate(${p.x} ${p.y})`} data-workstation="true">
      <ellipse cy="10" rx={half + 8} ry="13" fill="var(--iso-shadow)" />
      <path
        d={`M${-half + 5},-15v33 M${half - 5},-15v33`}
        stroke="var(--iso-wood-dark)"
        strokeWidth="6"
      />
      <rect
        x="-4"
        y="-55"
        width="27"
        height="30"
        rx="7"
        fill="var(--iso-chair)"
        stroke="var(--iso-wall-edge)"
        strokeWidth="2"
      />
      <Person x={9} y={-22} palette={palette} live={live} approval={approval} />
      <polygon
        points={points([
          [-half, -22, 23],
          [half, -22, 23],
          [half, 22, 23],
          [-half, 22, 23],
        ])}
        fill="var(--iso-wood)"
        stroke="var(--iso-gold)"
        strokeWidth="1.5"
      />
      <polygon
        points={points([
          [-half, 22, 23],
          [half, 22, 23],
          [half, 22, 14],
          [-half, 22, 14],
        ])}
        fill="var(--iso-wood-dark)"
      />
      <image
        href={asset('PC', live ? 'PC_FRONT_ON_1' : 'PC_FRONT_OFF')}
        x="-32"
        y="-55"
        width="31"
        height="34"
      />
      <path d="M-18,-18h22l-3,5h-23z" fill="var(--iso-keyboard)" />
      <rect x="26" y="-25" width="9" height="11" rx="1" fill="var(--iso-paper)" />
      <path d="M28 -22h5m-5 3h4" stroke="var(--iso-grout)" strokeWidth=".6" />
      {executive && (
        <>
          <rect x="-65" y="-27" width="17" height="10" fill="var(--iso-sign)" />
          <image href={asset('POT', 'POT')} x="50" y="-45" width="24" height="28" />
        </>
      )}
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
  id,
}: {
  name: string;
  positions: number;
  x: number;
  y: number;
  index: number;
  live?: boolean;
  approval?: boolean;
  onOpen?: () => void;
  id: string;
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
      aria-label={`${name} · ${positions} cargos planejados${live ? ' · Codex conectado' : ''}`}
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
        {name} — {live ? 'Sessão real Codex' : 'Cargos planejados; personagens ilustrativos'}
      </title>
      <polygon
        points={points([
          [0, 0, -9],
          [300, 0, -9],
          [300, 180, -9],
          [0, 180, -9],
        ])}
        fill="var(--iso-shadow)"
      />
      <polygon
        points={points(floor)}
        fill="var(--iso-floor)"
        stroke="var(--iso-wall-edge)"
        strokeWidth="5"
      />
      <polygon points={points(floor)} fill={`url(#${id}-stone)`} opacity=".34" />
      <polygon
        points={points([
          [0, 0],
          [300, 0],
          [300, 0, 92],
          [0, 0, 92],
        ])}
        fill="var(--iso-wall-back)"
        stroke="var(--iso-wall-edge)"
        strokeWidth="5"
      />
      <polygon
        points={points([
          [0, 0],
          [0, 180],
          [0, 180, 92],
          [0, 0, 92],
        ])}
        fill="var(--iso-wall-side)"
        stroke="var(--iso-wall-edge)"
        strokeWidth="4"
      />
      {[18, 42, 66, 90].map((z) => (
        <path key={z} d={`M0 ${-z}H300`} stroke="var(--iso-mortar)" strokeWidth="1" />
      ))}
      {[40, 105, 175, 245].map((x) => (
        <path key={x} d={`M${x} -92V0`} stroke="var(--iso-mortar)" strokeWidth="1" />
      ))}
      <polygon
        points={points([
          [7, 0, 85],
          [292, 0, 85],
          [292, 0, 17],
          [7, 0, 17],
        ])}
        fill={index === 7 ? `url(#${id}-sky)` : 'var(--iso-window)'}
        stroke="var(--iso-gold)"
        strokeWidth="2"
      />
      {index === 7 ? (
        Array.from({ length: 13 }, (_, i) => (
          <g key={i}>
            <rect
              x={13 + i * 21}
              y={-59 + ((i * 11) % 25)}
              width="17"
              height={42 - ((i * 11) % 25)}
              fill="var(--iso-building)"
            />
            {[0, 1, 2].map((j) => (
              <path
                key={j}
                d={`M${16 + i * 21} ${-47 + ((i * 11) % 25) + j * 8}h3m4 0h3`}
                stroke="var(--iso-light)"
                strokeWidth="2"
              />
            ))}
          </g>
        ))
      ) : (
        <g transform="translate(0 26)">
          <rect
            x="66"
            y="-74"
            width="166"
            height="54"
            rx="2"
            fill={index === 5 ? 'var(--iso-sign)' : 'var(--iso-paper)'}
            stroke="var(--iso-gold)"
            strokeWidth="3"
          />
          {index === 5 ? (
            Array.from({ length: 7 }, (_, i) => (
              <path
                key={i}
                d={`M77 ${-65 + i * 6}h${60 + ((i * 17) % 78)}`}
                stroke="var(--iso-code)"
                strokeWidth="2"
              />
            ))
          ) : (
            <>
              <path
                d="M79 -31L101 -45L120 -40L143 -60L165 -47L187 -56L218 -64"
                fill="none"
                stroke={color}
                strokeWidth="3"
              />
              {[18, 28, 35, 25, 42].map((h, i) => (
                <rect
                  key={i}
                  x={82 + i * 28}
                  y={-23 - h}
                  width="14"
                  height={h}
                  fill={color}
                  opacity=".3"
                />
              ))}
            </>
          )}
        </g>
      )}
      <path d="M4 -7H296" stroke={color} strokeWidth="5" />
      <ellipse cx="145" cy="45" rx="145" ry="93" fill={`url(#${id}-glow)`} />
      <image
        href={asset('DOUBLE_BOOKSHELF', 'DOUBLE_BOOKSHELF')}
        x="7"
        y="-38"
        width="48"
        height="48"
      />
      <image
        href={asset('DOUBLE_BOOKSHELF', 'DOUBLE_BOOKSHELF')}
        x="244"
        y="-38"
        width="45"
        height="45"
      />
      <Plant x={10} y={87} />
      <Plant x={274} y={98} />
      {workstationPositions(positions).map((p, i) => (
        <Desk
          key={i}
          {...p}
          palette={index + i}
          executive={positions === 1}
          live={live && i === 0}
          approval={approval && i === 0}
        />
      ))}
      <polygon
        points={points([
          [0, 180],
          [300, 180],
          [300, 180, -9],
          [0, 180, -9],
        ])}
        fill="var(--iso-base)"
        stroke="var(--iso-gold)"
        strokeWidth="2"
      />
      <g transform="translate(0 -73)">
        <rect
          width="295"
          height="27"
          rx="2"
          fill={color}
          stroke="var(--iso-gold)"
          strokeWidth="2"
        />
        <text x="147" y="18" textAnchor="middle" className="iso-room-title">
          {name.toLocaleUpperCase('pt-BR')}
        </text>
      </g>
      <g transform="translate(172 126)">
        <rect width="112" height="21" rx="4" fill="var(--iso-sign)" />
        <text x="56" y="14" textAnchor="middle" className="iso-count">
          {index === 7 ? 'Você · CEO' : `${positions} cargos planejados`}
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
        viewBox="0 0 1100 660"
        preserveAspectRatio="none"
        role="group"
        aria-labelledby={`${id}-title ${id}-description`}
        className="iso-scene"
        data-testid="md2-isometric-scene"
      >
        <title id={`${id}-title`}>MD2 IA Office — sete departamentos, recepção central e CEO</title>
        <desc id={`${id}-description`}>
          20 cargos planejados mais CEO. Personagens ilustrativos; somente Codex conectado
          representa execução real.{' '}
          {live ? 'Sessão real conectada.' : 'Nenhuma sessão Codex em execução.'}
        </desc>
        <defs>
          <pattern id={`${id}-tiles`} width="32" height="32" patternUnits="userSpaceOnUse">
            <rect width="32" height="32" fill="var(--iso-corridor)" />
            <image href="/assets/floors/floor_0.png" width="32" height="32" opacity=".22" />
            <path d="M0 0H32V32H0Z" fill="none" stroke="var(--iso-gold)" strokeWidth=".8" />
          </pattern>
          <pattern
            id={`${id}-stone`}
            width="32"
            height="32"
            patternUnits="userSpaceOnUse"
            patternTransform="matrix(1 0 -.14 .65 0 0)"
          >
            <image href="/assets/floors/floor_0.png" width="32" height="32" opacity=".45" />
            <path d="M0 0H32V32H0Z" fill="none" stroke="var(--iso-grout)" strokeWidth=".6" />
          </pattern>
          <radialGradient id={`${id}-glow`}>
            <stop stopColor="var(--iso-light)" stopOpacity=".48" />
            <stop offset="1" stopColor="var(--iso-light)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-sky`} x2="0" y2="1">
            <stop stopColor="var(--iso-sky)" />
            <stop offset="1" stopColor="var(--iso-window)" />
          </linearGradient>
        </defs>
        <rect
          x="4"
          y="4"
          width="1092"
          height="652"
          rx="9"
          fill={`url(#${id}-tiles)`}
          stroke="var(--iso-wall-edge)"
          strokeWidth="8"
        />
        <path
          d="M354 7V652M743 7V652"
          stroke="var(--iso-wall-edge)"
          strokeWidth="3"
          opacity=".35"
        />
        <path d="M364 8V651M733 8V651" stroke="var(--iso-light)" strokeWidth="2" opacity=".35" />
        <Room name="CEO · Você" positions={1} x={405} y={95} index={7} id={id} />
        {ISOMETRIC_ROOMS.filter((r) => r.id !== 'support').map((r, index) => (
          <Room
            key={r.id}
            name={r.name}
            positions={r.positions}
            x={r.x}
            y={r.y}
            index={index}
            live={r.id === 'technology' && !!live}
            approval={live?.status === 'approval'}
            onOpen={r.id === 'technology' ? onOpen : undefined}
            id={id}
          />
        ))}
        <g
          transform="translate(405 330)"
          data-room="Atendimento"
          aria-label="Atendimento · 2 cargos planejados"
        >
          <g data-room="Recepção">
            <rect
              x="4"
              y="-95"
              width="285"
              height="99"
              rx="5"
              fill="var(--iso-sign)"
              stroke="var(--iso-gold)"
              strokeWidth="3"
            />
            <text x="146" y="-50" textAnchor="middle" className="iso-brand-main">
              MD2
            </text>
            <text x="146" y="-20" textAnchor="middle" className="iso-brand-sub">
              IA OFFICE
            </text>
          </g>
          {[85, 217].map((x, i) => (
            <g key={i} data-workstation="true">
              <Person x={x} y={79} palette={3 + i} />
              <image href={asset('PC', 'PC_FRONT_OFF')} x={x - 48} y="28" width="33" height="36" />
            </g>
          ))}
          <polygon
            points="-8,66 283,66 300,85 7,85"
            fill="var(--iso-paper)"
            stroke="var(--iso-gold)"
            strokeWidth="2"
          />
          <path
            d="M7 85H300V127H7Z"
            fill="var(--iso-reception)"
            stroke="var(--iso-gold)"
            strokeWidth="3"
          />
          <path d="M14 91H293" stroke="var(--iso-light)" strokeWidth="2" opacity=".6" />
          <text x="151" y="112" textAnchor="middle" className="iso-room-title">
            RECEPÇÃO · ATENDIMENTO
          </text>
          <Plant x={-12} y={100} large />
          <Plant x={305} y={100} large />
          <rect x="81" y="140" width="145" height="20" rx="3" fill="var(--iso-sign)" />
          <text x="154" y="154" textAnchor="middle" className="iso-count">
            2 cargos planejados
          </text>
        </g>
        <g transform="translate(437 575)">
          <image href={asset('SOFA', 'SOFA_FRONT')} x="-25" y="-20" width="83" height="53" />
          <image href={asset('SOFA', 'SOFA_FRONT')} x="163" y="-20" width="83" height="53" />
          <ellipse cx="111" cy="24" rx="43" ry="22" fill="var(--iso-shadow)" />
          <ellipse
            cx="111"
            cy="16"
            rx="43"
            ry="22"
            fill="var(--iso-wood)"
            stroke="var(--iso-gold)"
            strokeWidth="3"
          />
          <Plant x={111} y={13} />
        </g>
        {[
          [366, 155],
          [739, 155],
          [366, 350],
          [739, 350],
          [366, 550],
          [739, 550],
        ].map(([x, y], i) => (
          <g key={i}>
            <ellipse cx={x} cy={y - 26} rx="46" ry="67" fill={`url(#${id}-glow)`} />
            <path d={`M${x} ${y}V${y - 47}`} stroke="var(--iso-gold)" strokeWidth="4" />
            <ellipse cx={x} cy={y + 2} rx="10" ry="4" fill="var(--iso-shadow)" />
            <path d={`M${x - 12} ${y - 47}h24l-5,-18h-14z`} fill="var(--iso-light)" />
            <Plant x={x + 10} y={y + 73} />
          </g>
        ))}
      </svg>
      <div className="iso-caption">
        <span>20 cargos planejados · personagens ilustrativos</span>
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
