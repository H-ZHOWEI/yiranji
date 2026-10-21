// 称谓习惯选择器：先选大方向（北方/南方），再选小地区细分（粤/客/闽/吴/湘…）
import { TITLE_REGIONS, TITLE_STYLE_SAMPLES, dialectRegion, type TitleDialect } from '../utils/kinship';
import './TitleStylePicker.css';

interface TitleStylePickerProps {
  value: TitleDialect;
  onChange: (value: TitleDialect) => void;
}

export default function TitleStylePicker({ value, onChange }: TitleStylePickerProps) {
  const region = dialectRegion(value);
  const current = TITLE_REGIONS.find((r) => r.id === region) || TITLE_REGIONS[0];
  const info = TITLE_STYLE_SAMPLES[value];

  return (
    <div className="tsp">
      <div className="tsp-regions">
        {TITLE_REGIONS.map((r) => {
          const active = r.id === region;
          return (
            <button
              key={r.id}
              type="button"
              className={`tsp-region${active ? ' is-active' : ''}`}
              onClick={() => {
                if (!active) onChange(r.fallback);
              }}
            >
              <span className="tsp-region-name">{r.name}</span>
              <span className="tsp-region-desc">{r.desc}</span>
            </button>
          );
        })}
      </div>

      <div className="tsp-dialects">
        <span className="tsp-label">细分地区</span>
        <div className="tsp-chips">
          {current.dialects.map((id) => (
            <button
              key={id}
              type="button"
              className={`tsp-chip${value === id ? ' is-active' : ''}`}
              onClick={() => onChange(id)}
            >
              {TITLE_STYLE_SAMPLES[id].name}
            </button>
          ))}
        </div>
      </div>

      <div className="tsp-preview">
        <div className="tsp-preview-head">
          <span className="tsp-preview-name">{info.name}</span>
          <span className="tsp-preview-desc">{info.desc}</span>
        </div>
        <div className="tsp-examples">
          {info.examples.map(([rel, term]) => (
            <span key={rel} className="tsp-example">
              <em>{rel}</em>
              {term}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
