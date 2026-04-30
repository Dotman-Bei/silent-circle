use arcis::*;

pub struct SetA {
    pub items: [u64; 4],
    pub count: u8,
}

pub struct SetB {
    pub items: [u64; 4],
    pub count: u8,
}

#[instruction]
pub fn compute_psi(set_a: Enc<Shared, SetA>, set_b: Enc<Shared, SetB>) -> [u64; 4] {
    let a = set_a.to_arcis();
    let b = set_b.to_arcis();

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
