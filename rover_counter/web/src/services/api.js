const API_BASE = '/api';

class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

async function fetchAPI(endpoint, options = {}) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
            ...options,
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new ApiError(error.error || 'Request failed', response.status);
        }

        if (response.status === 204) {
            return null;
        }

        return await response.json();
    } catch (error) {
        if (error instanceof ApiError) {
            throw error;
        }
        throw new ApiError('Network error', 0);
    }
}

export const teamsAPI = {
    getAll: () => fetchAPI('/teams'),
    create: (name, players) => fetchAPI('/teams', {
        method: 'POST',
        body: JSON.stringify({ name, players }),
    }),
    update: (id, name, players) => fetchAPI(`/teams/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, players }),
    }),
    delete: (id) => fetchAPI(`/teams/${id}`, {
        method: 'DELETE',
    }),
};

export const matchesAPI = {
    getAll: (status) => fetchAPI(`/matches${status ? `?status=${status}` : ''}`),
    create: (gameId, teamIds, settings) => fetchAPI('/matches', {
        method: 'POST',
        body: JSON.stringify({ gameId, teamIds, settings }),
    }),
    update: (id, teams, history) => fetchAPI(`/matches/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ teams, history }),
    }),
    finish: (id) => fetchAPI(`/matches/${id}/finish`, {
        method: 'POST',
    }),
    delete: (id) => fetchAPI(`/matches/${id}`, {
        method: 'DELETE',
    }),
};
