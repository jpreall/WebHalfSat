## Mathematical Background
### Halfsat using lander-waterman modeling

From Picard tools, we have the Lander-Waterman equation as follows:

$$
\begin{equation} \frac{C}{X} = 1 - e^\frac{-N}{X} \end{equation} \qquad (1)
$$

where

$X = number \enspace of \enspace distinct \enspace molecules \enspace in \enspace library$

$N = number \enspace  of \enspace  read \enspace  pairs$

$C = number\enspace of\enspace distinct\enspace fragments\enspace observed\enspace in\enspace read\enspace pairs$

From 10x genomics’ webpage, sequencing saturation is calculated as 

$s = 1 - \frac{n\textunderscore deduped\textunderscore reads}{n\textunderscore reads}$ where $s$ is the sequencing saturation, $n\textunderscore deduped\textunderscore reads$ is the number of unique (valid cell-barcode, valid-UMI, gene) combinations among confidently mapped reads, and $n\textunderscore reads$ is the total number of confidently mapped, valid cell-barcode, valid-UMI reads.

Using notation from the Lander-Waterman equation, we can rewrite the sequencing saturation equation as follows:

$$
\begin{equation}
s = 1 - \frac{C}{N} \qquad (2)
\end{equation}
$$

Our goal is to fit a model to predict sequencing saturation $s$ as a function of read pairs $N$ and number of distinct molecules in library $X$, optimizing for $X$.

In other words, $s = f(N)$. 

We can rewrite equation (2) as $C = (1-s)*N$ and use systems of equations to solve for $s$.

$$
\frac{(1-s)*N}{X} = 1-e^\frac{-N}{X}
$$

$$
\begin{equation}
s = 1-\frac{(1-e^\frac{-N}{X})*X}{N} \qquad (3)
\end{equation}
$$

where $s$ is a function of read pairs $N$.

From here, we can create a plot of sequencing saturation versus mean reads per cell (total reads divided by the number of cells). In order to find the half saturation point, we must use a root-finding algorithm such as Brent’s method to obtain a number $N$ such that $f(N) = 0.5$

$$
\begin{equation}
s = 1-\frac{(1-e^\frac{-N}{X})*X}{N}-0.5 \qquad (4)
\end{equation}
$$

 <br/><br/> 
### Halfsat using michaelis-menten modeling
The Michaelis-Menten equation is as follows:

$$
\begin{equation}
v = \frac{\mathrm{d}[P]}{\mathrm{d}t} = V_{max}\frac{[S]}{K_M+[S]} \qquad (5)
\end{equation}
$$

where

$v = rate\enspace of\enspace product\enspace formation$

$P = concentration\enspace of\enspace product$

$S = concentration\enspace of\enspace substrate$

$V_{max} = max\enspace rate\enspace achieved\enspace by\enspace system$

$K_M = michaelis\enspace constant$

When $K_M$ is  equivalent to the substrate concentration the reaction rate $v$ is half of $V_{max}$

Analogously, we can model the following:

$$
\begin{equation}
s = S_{max}\frac{R}{K_M+R} \qquad (6)
\end{equation}
$$

where

$s = sequencing\enspace saturation\enspace [0,1]$

$S_{max} = maximum\:sequencing\:saturation$

$R = reads\enspace per\enspace cell$

$K_M = michaelis\enspace constant$

Since $S_{max}=1$, we can simplify equation (5)

$$
\begin{equation}
s = \frac{R}{K_M+R} \qquad (7)
\end{equation}
$$

We can also use the Michaelis-Menten equation (5) to model genes per cell and UMIs per cell.

$s = median\enspace genes\enspace per\enspace cell$

$s = median\enspace UMIs\enspace per\enspace cell$
