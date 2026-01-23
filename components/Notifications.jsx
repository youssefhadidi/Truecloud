/** @format */

'use client';

import { FiX, FiAlertCircle, FiCheckCircle, FiInfo } from 'react-icons/fi';
import { useNotifications } from '@/contexts/NotificationsContext';

export default function Notifications() {
  const { notifications, dismissNotification } = useNotifications();

  const getIcon = (type) => {
    switch (type) {
      case 'success':
        return <FiCheckCircle className="text-green-500" size={20} />;
      case 'error':
        return <FiAlertCircle className="text-red-500" size={20} />;
      case 'info':
        return <FiInfo className="text-blue-500" size={20} />;
      default:
        return <FiInfo className="text-gray-500" size={20} />;
    }
  };

  const getStyles = (type) => {
    switch (type) {
      case 'success':
        return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
      case 'error':
        return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
      case 'info':
        return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
      default:
        return 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800';
    }
  };

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {notifications.map((notification, index) => (
        <div
          key={notification.id}
          className={`${getStyles(notification.type)} border rounded-lg shadow-lg p-4 flex items-start gap-3 animate-slide-in-right`}
          style={{
            animation: `slideInRight 0.3s ease-out ${index * 0.1}s both`,
          }}
        >
          <div className="flex-shrink-0 mt-0.5">{getIcon(notification.type)}</div>
          <div className="flex-1 min-w-0">
            {notification.title && <p className=" font-medium text-gray-900 dark:text-white mb-1">{notification.title}</p>}
            <p className=" text-gray-700 dark:text-gray-300">{notification.message}</p>
          </div>
          <button onClick={() => dismissNotification(notification.id)} className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
            <FiX size={18} />
          </button>
        </div>
      ))}
      <style jsx>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
