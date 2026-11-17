// The brewed batch a canning / kegging cell is packaging, if there is one yet: the batch of the
// booking the cell belongs to; otherwise a batch of the same beer brewed before the cell's date
// (the one packaged that day, else the one in a bright tank, else the oldest still in the cellar).
import { supabase } from '../supabaseClient'
import { sameBeer } from './incoming'

const COLS = 'id, batch_number, beer_style, status, date_brewed, package_date, bbt_transfer_date, fv_to_bbt_l, barrel_l, tanks(name, tank_type)'
const LIVE = ['fermenting', 'chilling', 'conditioning', 'barrelled']

export async function findPackBatch({ bookingId, beer, date }) {
  if (bookingId) {
    const { data: bk } = await supabase.from('brew_bookings').select('batch_id').eq('id', bookingId).maybeSingle()
    if (bk?.batch_id) {
      const { data } = await supabase.from('batches').select(COLS).eq('id', bk.batch_id).maybeSingle()
      if (data) return data
    }
  }
  if (!beer) return null
  const { data, error } = await supabase.from('batches').select(COLS)
    .lte('date_brewed', date)
    .or(`status.in.(${LIVE.join(',')}),package_date.eq.${date}`)
    .order('date_brewed')
  if (error) throw error
  const same = (data ?? []).filter((b) => sameBeer(b.beer_style, beer))
  return same.find((b) => b.package_date === date)
    ?? same.find((b) => b.status === 'conditioning' && b.tanks?.tank_type === 'BBT')
    ?? same.find((b) => LIVE.includes(b.status))
    ?? null
}
