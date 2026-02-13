/** @format */

import UpdateStatusClient from './UpdateStatusClient';

export const metadata = {
  title: 'Update Status - TrueCloud',
};

export default function UpdateStatusPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Server Update Status</h1>
      <UpdateStatusClient />
    </div>
  );
}
