# current todos:
1. Map c for filling, like what 'f' 'enter' currently does, and controls UI to reflect it
2. The # of workers that are spawn and running is not consistent? When using chromes, sometimes I get more workers running / better performance when I refresh. Answer why this is happening, and see if there is any ways to fix it. Also explain how workers work in our codebase. 
3. Clue dimming is too aggressive. In typical picross games, the individual hints/clues don't grey out until they're surrounded with x (or one side is next to the puzzle border, and the other side is touch x); or if there are multiple possibilities, if a series of block can be of multiple "2"s in a row clue of "2 2 2", don't dim any of them, especially to not give it away.
4. Consecutive filling / crossing / penciling: When holding fill (f, c, enter) + arrow, the cursor should go down one by one and filling all the blocks touched by the cursor. Similar for or cross-out ('/' or x) + arrow, or pencil (space or ') + arrow. 

# Future todos:
5. Controller support: this game 