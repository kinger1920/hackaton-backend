import React, {useEffect, useRef, useState} from 'react';
import {Check, ChevronDown, Globe} from 'lucide-react';
import {LanguageCode, SUPPORTED_LANGUAGES, useLanguage} from '../context/LanguageContext';
import './LanguageSwitcher.css';

const FlagIcon: React.FC<{ code: LanguageCode }> = ({ code }) => {
  switch (code) {
    case 'de':
      return (
        <svg className="lang-flag-svg" viewBox="0 0 24 16" aria-hidden="true">
          <rect className="flag-de-black" width="24" height="5.34" y="0" />
          <rect className="flag-de-red" width="24" height="5.34" y="5.33" />
          <rect className="flag-de-gold" width="24" height="5.34" y="10.66" />
        </svg>
      );
    case 'en':
      return (
        <svg className="lang-flag-svg" viewBox="0 0 24 16" aria-hidden="true">
          <rect className="flag-uk-blue" width="24" height="16" />
          <path className="flag-white-stroke" d="M0,0 L24,16 M24,0 L0,16" strokeWidth="3.2" />
          <path className="flag-uk-red-stroke" d="M0,0 L24,16 M24,0 L0,16" strokeWidth="1.6" />
          <path className="flag-white-stroke" d="M12,0 V16 M0,8 H24" strokeWidth="5" />
          <path className="flag-uk-red-stroke" d="M12,0 V16 M0,8 H24" strokeWidth="3" />
        </svg>
      );
    case 'pl':
      return (
        <svg className="lang-flag-svg" viewBox="0 0 24 16" aria-hidden="true">
          <rect className="flag-white-fill" width="24" height="8" y="0" />
          <rect className="flag-pl-red" width="24" height="8" y="8" />
        </svg>
      );
  }
};

export const LanguageSwitcher: React.FC = () => {
  const { language, setLanguage, currentLanguageOption } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleSelect = (code: LanguageCode) => {
    setLanguage(code);
    setIsOpen(false);
  };

  return (
    <div className="lang-switcher-wrapper" ref={containerRef}>
      <button
        type="button"
        className="lang-switcher-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="Sprache wechseln / Switch Language"
        aria-label="Language selection"
      >
        <Globe size={14} />
        <span className="lang-flag">
          <FlagIcon code={currentLanguageOption.code} />
        </span>
        <span className="lang-code">{currentLanguageOption.code}</span>
        <ChevronDown size={13} style={{ opacity: 0.7 }} />
      </button>

      {isOpen && (
        <div className="lang-dropdown-menu">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const isSelected = lang.code === language;
            return (
              <button
                key={lang.code}
                type="button"
                className={`lang-option-item ${isSelected ? 'active' : ''}`}
                onClick={() => handleSelect(lang.code)}
              >
                <div className="lang-option-left">
                  <span className="lang-flag">
                    <FlagIcon code={lang.code} />
                  </span>
                  <span>{lang.label}</span>
                </div>
                {isSelected && <Check size={14} color="var(--color-primary)" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default LanguageSwitcher;

