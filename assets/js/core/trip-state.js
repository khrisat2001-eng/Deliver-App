const TERMINAL = new Set([
    'COMPLETED',
    'CANCELLED_BY_CUSTOMER',
    'CANCELLED_BY_DRIVER',
    'CANCELLED_BY_ADMIN',
    'NO_DRIVER_FOUND',
]);
/** to-status → which actors may move a trip there, from which statuses. */
const TRANSITIONS = {
    REQUESTED: { from: [], by: [] },
    SEARCHING: { from: ['REQUESTED', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING'], by: ['SYSTEM'] },
    DRIVER_ASSIGNED: { from: ['SEARCHING'], by: ['DRIVER', 'ADMIN'] },
    DRIVER_ARRIVING: { from: ['DRIVER_ASSIGNED'], by: ['DRIVER', 'SYSTEM'] },
    DRIVER_ARRIVED: { from: ['DRIVER_ARRIVING', 'DRIVER_ASSIGNED'], by: ['DRIVER'] },
    IN_PROGRESS: { from: ['DRIVER_ARRIVED'], by: ['DRIVER'] },
    COMPLETED: { from: ['IN_PROGRESS'], by: ['DRIVER', 'ADMIN'] },
    CANCELLED_BY_CUSTOMER: {
        from: ['REQUESTED', 'SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'],
        by: ['CUSTOMER'],
    },
    CANCELLED_BY_DRIVER: { from: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'], by: ['DRIVER'] },
    CANCELLED_BY_ADMIN: {
        from: ['REQUESTED', 'SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'],
        by: ['ADMIN'],
    },
    NO_DRIVER_FOUND: { from: ['SEARCHING'], by: ['SYSTEM'] },
};
export function isTerminal(s) {
    return TERMINAL.has(s);
}
export function canTransition(from, to, actor) {
    const t = TRANSITIONS[to];
    return t.from.includes(from) && t.by.includes(actor);
}
export class InvalidTransitionError extends Error {
    constructor(from, to, actor) {
        super(`${actor} cannot move trip from ${from} to ${to}`);
        this.name = 'InvalidTransitionError';
    }
}
export function assertTransition(from, to, actor) {
    if (!canTransition(from, to, actor))
        throw new InvalidTransitionError(from, to, actor);
}
/** Driver availability that must accompany a trip status. */
export function driverAvailabilityFor(status) {
    if (['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(status))
        return 'ON_TRIP';
    if (status === 'COMPLETED' || status.startsWith('CANCELLED'))
        return 'ONLINE';
    return null;
}
