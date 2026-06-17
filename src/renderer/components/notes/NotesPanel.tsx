import React, { useState, useEffect, useCallback } from 'react';

interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

type SortMode = 'updated' | 'created' | 'title';

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mdToHtml(md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg-elevated);padding:1px 4px;border-radius:3px;font-size:0.9em">$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    (_match, label: string, url: string) =>
      `<a href="${escapeAttr(url)}" style="color:var(--accent);text-decoration:underline" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
  html = html.replace(/^[-*] (.+)$/gm, '<li style="margin-left:16px;list-style:disc">$1</li>');
  html = html.replace(/\n/g, '<br/>');
  return html;
}

interface NotesAPI {
  list: () => Promise<Note[]>;
  create: (data: { title: string; content?: string; tags?: string[]; pinned?: boolean }) => Promise<Note>;
  update: (id: string, data: { title?: string; content?: string; tags?: string[]; pinned?: boolean }) => Promise<Note>;
  delete: (id: string) => Promise<boolean>;
}

function getNotesAPI(): NotesAPI {
  return (window as unknown as { electronAPI: { notes: NotesAPI } }).electronAPI.notes;
}

function showToast(message: string, type: 'info' | 'error' = 'error') {
  window.dispatchEvent(new CustomEvent('catalyst-toast', { detail: { message, type } }));
}

export function NotesPanel() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('updated');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await getNotesAPI().list();
      setNotes(list);
    } catch {
      showToast('Failed to load notes');
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = useCallback(async () => {
    try {
      const created = await getNotesAPI().create({ title: 'Untitled Note', content: '', tags: [] });
      setNotes(prev => [created, ...prev]);
      setEditingId(created.id);
      setEditTitle(created.title);
      setEditContent(created.content);
      setEditTags(created.tags);
      setTagInput('');
    } catch { showToast('Failed to create note'); }
  }, []);

  const handleSave = useCallback(async () => {
    if (!editingId) return;
    try {
      const updated = await getNotesAPI().update(editingId, {
        title: editTitle,
        content: editContent,
        tags: editTags,
      });
      setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
      setEditingId(null);
    } catch { showToast('Failed to save note'); }
  }, [editingId, editTitle, editContent, editTags]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await getNotesAPI().delete(id);
      setNotes(prev => prev.filter(n => n.id !== id));
      if (editingId === id) setEditingId(null);
      setDeleteConfirmId(null);
    } catch { showToast('Failed to delete note'); }
  }, [editingId]);

  const handlePin = useCallback(async (id: string) => {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    try {
      const updated = await getNotesAPI().update(id, { pinned: !note.pinned });
      setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
    } catch { showToast('Failed to update note'); }
  }, [notes]);

  const openEditor = useCallback((note: Note) => {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content);
    setEditTags(note.tags);
    setTagInput('');
  }, []);

  const handleAddTag = useCallback(() => {
    const trimmed = tagInput.trim();
    if (!trimmed || editTags.includes(trimmed)) return;
    setEditTags(prev => [...prev, trimmed]);
    setTagInput('');
  }, [tagInput, editTags]);

  const handleRemoveTag = useCallback((tag: string) => {
    setEditTags(prev => prev.filter(t => t !== tag));
  }, []);

  const lowerSearch = search.toLowerCase();
  const filtered = notes.filter(n => {
    if (!lowerSearch) return true;
    return (
      n.title.toLowerCase().includes(lowerSearch) ||
      n.content.toLowerCase().includes(lowerSearch) ||
      n.tags.some(t => t.toLowerCase().includes(lowerSearch))
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    switch (sort) {
      case 'updated': return b.updatedAt - a.updatedAt;
      case 'created': return b.createdAt - a.createdAt;
      case 'title': return a.title.localeCompare(b.title);
      default: return 0;
    }
  });

  const isEmpty = notes.length === 0 && !loading;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <h3 style={{
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text-primary)',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          width: 3, height: 14, borderRadius: 2,
          background: 'var(--accent-gradient)',
        }} />
        Notes
      </h3>

      {!isEmpty && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search notes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1,
              padding: '7px 10px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: 12,
              outline: 'none',
            }}
          />
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortMode)}
            style={{
              padding: '7px 8px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              fontSize: 11,
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="updated">Last Updated</option>
            <option value="created">Created</option>
            <option value="title">Title A-Z</option>
          </select>
        </div>
      )}

      {!isEmpty && (
        <button
          onClick={handleCreate}
          style={{
            width: '100%',
            padding: '9px 0',
            background: 'var(--accent-gradient)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            marginBottom: 14,
            transition: 'opacity var(--transition-fast)',
          }}
          onMouseEnter={e => { (e.target as HTMLButtonElement).style.opacity = '0.85'; }}
          onMouseLeave={e => { (e.target as HTMLButtonElement).style.opacity = '1'; }}
        >
          + New Note
        </button>
      )}

      {loading && (
        <div style={{
          textAlign: 'center',
          color: 'var(--text-secondary)',
          fontSize: 12,
          padding: 32,
        }}>
          Loading notes...
        </div>
      )}

      {isEmpty && (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: 'var(--text-secondary)',
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12, opacity: 0.5 }}>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>No notes yet</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
            Capture ideas, TODOs, and quick references right inside Catalyst.
          </div>
          <button
            onClick={handleCreate}
            style={{
              padding: '9px 24px',
              background: 'var(--accent-gradient)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'opacity var(--transition-fast)',
            }}
            onMouseEnter={e => { (e.target as HTMLButtonElement).style.opacity = '0.85'; }}
            onMouseLeave={e => { (e.target as HTMLButtonElement).style.opacity = '1'; }}
          >
            Create your first note
          </button>
        </div>
      )}

      {!loading && sorted.map(note => {
        const isEditing = editingId === note.id;
        const isDeleting = deleteConfirmId === note.id;

        if (isEditing) {
          return (
            <div
              key={note.id}
              style={{
                padding: 14,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-active)',
                borderRadius: 'var(--radius-md)',
                marginBottom: 8,
              }}
            >
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                placeholder="Title"
                autoFocus
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  fontWeight: 600,
                  outline: 'none',
                  marginBottom: 8,
                  boxSizing: 'border-box',
                }}
              />
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                placeholder="Write your note..."
                rows={6}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  lineHeight: 1.6,
                  outline: 'none',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  marginBottom: 8,
                  boxSizing: 'border-box',
                }}
              />

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {editTags.map(tag => (
                  <span
                    key={tag}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 8px',
                      background: 'var(--accent-dim)',
                      color: 'var(--accent)',
                      borderRadius: 10,
                      fontSize: 10,
                      fontWeight: 500,
                    }}
                  >
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      aria-label={`Remove tag ${tag}`}
                      style={{ cursor: 'pointer', opacity: 0.7, fontSize: 12, lineHeight: 1, background: 'none', border: 'none', padding: 0, color: 'inherit' }}
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <input
                  type="text"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                  placeholder="Add tag + Enter"
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: 11,
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setEditingId(null)}
                  style={{
                    padding: '5px 14px',
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-secondary)',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  style={{
                    padding: '5px 14px',
                    background: 'var(--accent)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          );
        }

        const preview = note.content.length > 80
          ? note.content.slice(0, 80) + '...'
          : note.content;

        return (
          <div
            key={note.id}
            style={{
              padding: 12,
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 8,
              cursor: 'pointer',
              transition: 'border-color var(--transition-fast)',
            }}
            onClick={() => openEditor(note)}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-active)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  {note.pinned && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <path d="M12 17v5" />
                      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
                    </svg>
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{note.title || 'Untitled'}</span>
                </div>

                {note.tags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {note.tags.map(tag => (
                      <span
                        key={tag}
                        style={{
                          padding: '1px 6px',
                          background: 'var(--accent-dim)',
                          color: 'var(--accent)',
                          borderRadius: 8,
                          fontSize: 9,
                          fontWeight: 500,
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {preview && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      marginTop: 4,
                      lineHeight: 1.5,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    dangerouslySetInnerHTML={{ __html: mdToHtml(preview) }}
                  />
                )}
              </div>

              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 4,
                flexShrink: 0,
              }}>
                <span style={{ fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {relativeTime(note.updatedAt)}
                </span>
                <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => handlePin(note.id)}
                    title={note.pinned ? 'Unpin' : 'Pin to top'}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 2,
                      color: note.pinned ? 'var(--accent)' : 'var(--text-secondary)',
                      opacity: note.pinned ? 1 : 0.5,
                      transition: 'opacity var(--transition-fast)',
                    }}
                    onMouseEnter={e => { (e.target as HTMLButtonElement).style.opacity = '1'; }}
                    onMouseLeave={e => { (e.target as HTMLButtonElement).style.opacity = note.pinned ? '1' : '0.5'; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={note.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 17v5" />
                      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(isDeleting ? null : note.id)}
                    title="Delete"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 2,
                      color: 'var(--text-secondary)',
                      opacity: 0.5,
                      transition: 'opacity var(--transition-fast)',
                    }}
                    onMouseEnter={e => { (e.target as HTMLButtonElement).style.opacity = '1'; }}
                    onMouseLeave={e => { (e.target as HTMLButtonElement).style.opacity = '0.5'; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {isDeleting && (
              <div
                style={{
                  marginTop: 8,
                  padding: '8px 10px',
                  background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 11,
                }}
                onClick={e => e.stopPropagation()}
              >
                <span style={{ color: 'var(--text-secondary)' }}>Delete this note?</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    style={{
                      padding: '3px 10px',
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-secondary)',
                      fontSize: 10,
                      cursor: 'pointer',
                    }}
                  >
                    No
                  </button>
                  <button
                    onClick={() => handleDelete(note.id)}
                    style={{
                      padding: '3px 10px',
                      background: '#e53e3e',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {!loading && !isEmpty && sorted.length === 0 && search && (
        <div style={{
          textAlign: 'center',
          padding: '24px 16px',
          color: 'var(--text-secondary)',
          fontSize: 12,
        }}>
          No notes match "{search}"
        </div>
      )}
    </div>
  );
}
