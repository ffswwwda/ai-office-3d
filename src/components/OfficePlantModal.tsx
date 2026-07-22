import { createPortal } from 'react-dom'

export function OfficePlantModal({ text, onClose }: { text: string; onClose: () => void }) {
  return createPortal(
    <div className="plant-overlay" onClick={onClose}>
      <div className="plant-card" onClick={(e) => e.stopPropagation()}>
        <button className="plant-close" onClick={onClose} aria-label="关闭">×</button>
        <div className="plant-body">
          <svg className="plant-leaf" viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#4a9e6b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22c4-4 7-9 7-14a7 7 0 0 0-7 7 7 7 0 0 0-7-7c0 5 3 10 7 14z"/>
          </svg>
          <p className="plant-text">{text}</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
