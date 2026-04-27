use arcis::*;

/// Private Set Intersection for SilentCircle.
///
/// Both wallets encrypt the first 8 bytes (as u64) of the SHA-256 hash of each
/// mint address they hold. The MXE runs this circuit and reveals ONLY the mints
/// that appear in BOTH sets — neither party ever sees the other's full list.
///
/// Parameters:
///   set_a  — wallet A's asset fingerprints, encrypted jointly with the MXE key
///   set_b  — wallet B's asset fingerprints, encrypted jointly with the MXE key
///
/// Returns: [u64; 4] — up to 4 matching fingerprints (zero-padded). Each non-zero
/// entry in the result corresponds to a mint held by both wallets.
#[encrypted]
mod circuits {
    use arcis::*;

    /// Wallet A's set: up to 4 asset fingerprints (first 8 bytes of SHA-256 of
    /// each mint address). Padded with zeros if fewer than 4 assets.
    pub struct SetA {
        items: [u64; 4],
        count: u8,
    }

    /// Wallet B's set — same layout as SetA.
    pub struct SetB {
        items: [u64; 4],
        count: u8,
    }

    #[instruction]
    pub fn compute_psi(set_a: Enc<Shared, SetA>, set_b: Enc<Shared, SetB>) -> [u64; 4] {
        let a = set_a.to_arcis();
        let b = set_b.to_arcis();

        // Fixed 4×4 = 16 comparisons — circuit size is compile-time constant.
        // A slot in set_a "matches" if the same fingerprint appears anywhere in set_b.
        // Zero fingerprints are treated as empty (never match).
        let mut result = [0u64; 4];

        if a.items[0] != 0 {
            if a.items[0] == b.items[0]
                || a.items[0] == b.items[1]
                || a.items[0] == b.items[2]
                || a.items[0] == b.items[3]
            {
                result[0] = a.items[0];
            }
        }
        if a.items[1] != 0 {
            if a.items[1] == b.items[0]
                || a.items[1] == b.items[1]
                || a.items[1] == b.items[2]
                || a.items[1] == b.items[3]
            {
                result[1] = a.items[1];
            }
        }
        if a.items[2] != 0 {
            if a.items[2] == b.items[0]
                || a.items[2] == b.items[1]
                || a.items[2] == b.items[2]
                || a.items[2] == b.items[3]
            {
                result[2] = a.items[2];
            }
        }
        if a.items[3] != 0 {
            if a.items[3] == b.items[0]
                || a.items[3] == b.items[1]
                || a.items[3] == b.items[2]
                || a.items[3] == b.items[3]
            {
                result[3] = a.items[3];
            }
        }

        result.reveal()
    }
}
