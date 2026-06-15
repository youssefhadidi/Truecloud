/** @format */
// adminIndexation strings (en + fr must mirror keys).
export const ns = 'adminIndexation';

export const en = {
  title: 'File Indexation',
  refresh: 'Refresh',
  filesIndexed: 'Files Indexed',
  dirsIndexed: 'Directories Indexed',
  watcher: 'Watcher:',
  active: 'Active',
  inactive: 'Inactive',
  lastIndexed: 'Last indexed: {date}',
  loadStatsFailed: 'Failed to load index stats',
  rebuilding: 'Rebuilding Index...',
  itemsProgress: '{processed} / {total} items',
  rebuildIndex: 'Rebuild Index',
  rebuildingShort: 'Rebuilding...',
  clearIndex: 'Clear Index',
  clearTitle: 'Clear File Index?',
  clearWarning:
    'This will delete all indexed file entries. The index will need to be rebuilt to enable search functionality.',
  cancel: 'Cancel',
  rebuildStarted: 'Index rebuild started',
  clearedN: 'Cleared {count} index entries',
  rebuildFailed: 'Index rebuild failed: {error}',
  rebuiltWithN: 'Index rebuilt with {count} entries',
};

export const fr = {
  title: 'Indexation des fichiers',
  refresh: 'Actualiser',
  filesIndexed: 'Fichiers indexés',
  dirsIndexed: 'Dossiers indexés',
  watcher: 'Surveillance :',
  active: 'Active',
  inactive: 'Inactive',
  lastIndexed: 'Dernière indexation : {date}',
  loadStatsFailed: 'Échec du chargement des statistiques d\'index',
  rebuilding: "Reconstruction de l'index...",
  itemsProgress: '{processed} / {total} éléments',
  rebuildIndex: "Reconstruire l'index",
  rebuildingShort: 'Reconstruction...',
  clearIndex: "Vider l'index",
  clearTitle: "Vider l'index des fichiers ?",
  clearWarning:
    "Cela supprimera toutes les entrées de fichiers indexées. L'index devra être reconstruit pour réactiver la recherche.",
  cancel: 'Annuler',
  rebuildStarted: "Reconstruction de l'index démarrée",
  clearedN: '{count} entrées d\'index supprimées',
  rebuildFailed: "Échec de la reconstruction de l'index : {error}",
  rebuiltWithN: 'Index reconstruit avec {count} entrées',
};
