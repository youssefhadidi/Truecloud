/** @format */

'use client';

export default function Tabs({ tabs, active, onChange }) {
  return (
    <div className="border-b border-gray-700 mb-6 flex gap-1 overflow-x-auto overflow-y-hidden">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        const Icon = tab.icon;
        const hasBadge = tab.badge !== undefined && tab.badge !== null && tab.badge !== 0 && tab.badge !== '';
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              isActive
                ? 'border-blue-500 text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
            }`}
          >
            {Icon && <Icon size={16} />}
            {tab.label}
            {hasBadge && (
              <span
                className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold tabular-nums ${
                  isActive ? 'bg-blue-500 text-white' : 'bg-amber-500/90 text-gray-900'
                }`}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
