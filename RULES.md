# Declare - Core Rules

## Objective

Keep the lowest cumulative score and remain the last player below the game's point limit.

## Players and Setup

- 2-6 players.
- Use two standard 52-card decks plus six natural jokers, for 110 cards total.
- Deal seven cards to every active player at the start of each round.
- Reveal a random non-joker card to establish the wild rank. Every card of that rank is a joker for the round.
- Natural jokers and wild-rank cards are worth zero points.
- Reveal one starting card. It is available for the first player to pick up.
- The starting player rotates after each round.

## Card Values

- Ace: 1 point.
- Cards 2-10: face value.
- Jack, Queen, and King: 10 points.
- Natural jokers and wild-rank cards: 0 points.

## Valid Plays

On a turn, a player must play one of:

- Any single card.
- Two or more cards of the same rank.
- A sequence of three or four consecutive cards in the same suit.

Jokers may substitute for cards in groups or sequences, but a sequence cannot consist entirely of jokers. Ace is low only: A-2-3 is valid, while Q-K-A is not.

## Turn Flow

1. Play a valid card or combination from your hand.
2. Unless the play qualifies for a skip, pick up exactly one card from either:
   - the face-down deck, or
   - the cards played by the previous player. If multiple cards were played,
     the player chooses which one to take.
3. The cards just played become available to the next player.
4. Picking up a card ends the turn immediately.

If a player empties their hand, the round ends immediately. That player has a
hand value of 0 and receives 0 points for the round. Every other active player
adds the value of their remaining hand to their cumulative score.

## Empty Draw Deck

When the face-down draw deck is empty, shuffle all previously played cards into
a new draw deck except for the most recent play. The most recent play remains
face up and available to the current player.

## Skipping the Pickup

A player may end their turn without picking up when their play connects to the
previous play. They may still choose to pick up one card from the previous play,
but they cannot draw from the face-down deck:

- Group to group: both have the same rank.
- Group to sequence: the group's rank equals the sequence's lowest rank.
- Sequence to group: the sequence's highest rank equals the group's rank.
- Sequence to sequence: the new sequence's lowest rank equals the previous sequence's highest rank.

On the first turn of a round, the revealed starting card acts as the previous play. The starting player skips pickup by playing its rank as a group or by playing a sequence beginning with its rank.

## Declaring

- Declaring becomes available only after every active player has completed one turn in the current round.
- A player may declare only at the start of their turn, before playing cards.
- The declaring player's hand must total 15 points or fewer.
- A declaration succeeds if no opponent has a strictly lower hand total.
- Equal totals do not defeat the declaration.

### Successful Declaration

- The declarer receives -5 points.
- Every other active player adds their current hand value to their cumulative score.
- The round ends.

### Failed Declaration

- The declarer receives +30 points.
- The opponent with the lowest hand total receives -3 points.
- Every other active player adds their current hand value to their cumulative score.
- If challengers tie, the first tied player after the declarer in turn order wins the challenge.
- The round ends.

## Elimination and Winning

- The point limit is configurable; the default is 100.
- A player who reaches or exceeds the limit is eliminated.
- If re-entry is enabled, the first time this happens the player remains active, uses their one re-entry, and their score becomes the highest score among the other active players.
- The last non-eliminated player wins.
