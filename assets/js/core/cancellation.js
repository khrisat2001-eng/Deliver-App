/** Fee charged to a customer who cancels. Drivers are never charged money; their cancellation rate is tracked instead. */
export function customerCancellationFee(p, c) {
    if (c.status === 'REQUESTED' || c.status === 'SEARCHING')
        return 0;
    if (c.driverLate)
        return 0;
    if (c.status === 'DRIVER_ARRIVED') {
        return (c.secondsSinceArrived ?? 0) >= p.noShowAfterS ? p.feeAfterArrived : c.secondsSinceAccepted > p.freeWindowS ? p.fee : 0;
    }
    return c.secondsSinceAccepted > p.freeWindowS ? p.fee : 0;
}
export function cancellationRate(cancelled, total) {
    return total === 0 ? 0 : Number(((cancelled / total) * 100).toFixed(2));
}
