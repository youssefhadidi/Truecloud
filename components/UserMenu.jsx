/** @format */

'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { FiChevronDown, FiUser, FiDownload, FiLogOut, FiShare2 } from 'react-icons/fi';

export default function UserMenu({ email, isAdmin = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const router = useRouter();

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debug: log when isAdmin changes
  useEffect(() => {
    console.log('UserMenu - isAdmin prop changed:', isAdmin);
  }, [isAdmin]);

  const handleAdminPanel = () => {
    router.push('/admin');
    setIsOpen(false);
  };

  const handleDownloads = () => {
    router.push('/downloads');
    setIsOpen(false);
  };

  const handleShares = () => {
    router.push('/shares');
    setIsOpen(false);
  };

  const handleSignOut = async () => {
    setIsOpen(false);
    await signOut({ redirect: false });
    router.push('/auth/login');
  };

  return (
    <div ref={menuRef} className="relative">
      <button onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors">
        <FiUser size={20} />
        <span className="hidden sm:inline text-sm font-medium truncate max-w-[150px]">{email}</span>
        <FiChevronDown size={16} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-gray-800 rounded-lg shadow-lg border border-gray-700 py-1 z-50">
          {isAdmin && (
            <>
              <button
                onClick={handleAdminPanel}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
              >
                <FiUser size={16} />
                Admin Panel
              </button>
              <hr className="my-1 border-gray-700" />
            </>
          )}

          <button
            onClick={handleShares}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <FiShare2 size={16} />
            My Shares
          </button>

          <button
            onClick={handleDownloads}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
          >
            <FiDownload size={16} />
            Downloads
          </button>

          <hr className="my-1 border-gray-700" />

          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-400 hover:bg-red-900/20 transition-colors"
          >
            <FiLogOut size={16} />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
